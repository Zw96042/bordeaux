import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AgentRequest, AgentSessionService } from "./agentSession";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
let bridgeLifecycle: Promise<void> = Promise.resolve();

export interface AgentRuntimeDescriptor {
  schemaVersion: 1;
  protocolVersion: 1;
  pid: number;
  createdAt: string;
  instanceId: string;
  endpoint: string;
  token: string;
}

interface BridgeEnvelope {
  id: string;
  token: string;
  request: AgentRequest;
}

function descriptorPath(userData: string): string {
  return path.join(userData, "mcp", "runtime-v1.json");
}

async function removeOwnedDescriptor(userData: string, owner: AgentRuntimeDescriptor): Promise<void> {
  const target = descriptorPath(userData);
  let current: AgentRuntimeDescriptor;
  try { current = JSON.parse(await fs.promises.readFile(target, "utf8")) as AgentRuntimeDescriptor; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return;
    throw error;
  }
  if (current.instanceId !== owner.instanceId || current.endpoint !== owner.endpoint || current.token !== owner.token) return;
  await fs.promises.rm(target, { force: true });
}

function encode(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_MESSAGE_BYTES) throw new Error("Agent bridge message exceeds 1 MiB");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function readOne(socket: net.Socket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let received = 0;
    let frameSize: number | null = null;
    const timer = setTimeout(() => finish(new Error("Agent bridge request timed out")), timeoutMs);
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      error ? reject(error) : resolve(value);
    };
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (frameSize === null && received >= 4) {
        const header = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, received);
        frameSize = header.readUInt32BE(0);
        if (frameSize < 2 || frameSize > MAX_MESSAGE_BYTES) return finish(new Error("Agent bridge frame size is invalid"));
        if (chunks.length > 1) chunks = [header];
      }
      if (frameSize === null || received < frameSize + 4) return;
      const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, received);
      try { finish(undefined, JSON.parse(buffer.subarray(4, frameSize + 4).toString("utf8"))); }
      catch { finish(new Error("Agent bridge returned invalid JSON")); }
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

function endpointForLaunch(): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\bordeaux-mcp-${randomUUID()}`;
  return path.join(os.tmpdir(), `bordeaux-mcp-${typeof process.getuid === "function" ? process.getuid() : "user"}-${randomBytes(6).toString("hex")}.sock`);
}

export class AgentBridgeServer {
  private server: net.Server | null = null;
  private descriptor: AgentRuntimeDescriptor | null = null;
  private readonly sockets = new Set<net.Socket>();

  constructor(private readonly userData: string, private readonly sessions: AgentSessionService) {}

  get enabled(): boolean { return this.server !== null; }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    // The desktop lock guarantees one process; the shared queue also prevents
    // stale server objects in that process from racing descriptor publication.
    const result = bridgeLifecycle.then(operation, operation);
    bridgeLifecycle = result.then(() => undefined, () => undefined);
    return result;
  }

  start(): Promise<AgentRuntimeDescriptor> {
    return this.serialize(() => this.startNow());
  }

  private async startNow(): Promise<AgentRuntimeDescriptor> {
    if (this.descriptor) return this.descriptor;
    const endpoint = endpointForLaunch();
    const descriptor: AgentRuntimeDescriptor = {
      schemaVersion: 1,
      protocolVersion: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      instanceId: randomUUID(),
      endpoint,
      token: randomBytes(32).toString("base64url"),
    };
    const server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
      void readOne(socket, REQUEST_TIMEOUT_MS).then(async (raw) => {
        const envelope = raw as Partial<BridgeEnvelope>;
        if (!envelope || envelope.token !== descriptor.token || typeof envelope.id !== "string" || !envelope.request) throw new Error("Agent bridge authentication failed");
        const controller = new AbortController();
        socket.once("close", () => controller.abort());
        const result = await this.sessions.request(envelope.request, controller.signal);
        socket.end(encode({ id: envelope.id, result }));
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!socket.destroyed) socket.end(encode({ error: message }));
      });
    });
    const target = descriptorPath(this.userData);
    const temporary = `${target}.${descriptor.instanceId}.tmp`;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => { server.off("error", reject); resolve(); });
      });
      if (process.platform !== "win32") await fs.promises.chmod(endpoint, 0o600);
      await fs.promises.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(temporary, JSON.stringify(descriptor), { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.promises.rename(temporary, target);
      this.server = server;
      this.descriptor = descriptor;
      return descriptor;
    } catch (error) {
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.promises.rm(temporary, { force: true });
      if (process.platform !== "win32") await fs.promises.rm(endpoint, { force: true });
      throw error;
    }
  }

  stop(): Promise<void> {
    return this.serialize(() => this.stopNow());
  }

  private async stopNow(): Promise<void> {
    const server = this.server;
    const descriptor = this.descriptor;
    this.server = null;
    this.descriptor = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (descriptor) await removeOwnedDescriptor(this.userData, descriptor);
    if (descriptor && process.platform !== "win32") await fs.promises.rm(descriptor.endpoint, { force: true });
  }
}

export class AgentBridgeClient {
  constructor(private readonly userData: string) {}

  private async readDescriptor(): Promise<AgentRuntimeDescriptor> {
    const target = descriptorPath(this.userData);
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(target); }
    catch { throw new Error("Open Bordeaux and enable Agents → MCP Access, then retry."); }
    if (!stat.isFile() || stat.size > 16_384) throw new Error("The Bordeaux MCP runtime descriptor is invalid.");
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("The Bordeaux MCP runtime descriptor is not private to this user.");
    if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("The Bordeaux MCP runtime descriptor belongs to another user.");
    const value = JSON.parse(await fs.promises.readFile(target, "utf8")) as AgentRuntimeDescriptor;
    if (value.schemaVersion !== 1 || value.protocolVersion !== 1 || typeof value.endpoint !== "string" || typeof value.token !== "string" || value.pid <= 0) throw new Error("The Bordeaux MCP runtime descriptor is incompatible.");
    try { process.kill(value.pid, 0); } catch { throw new Error("The Bordeaux MCP session is no longer running."); }
    if (process.platform !== "win32") {
      // GUI apps and MCP clients can inherit different TMPDIR values on macOS.
      // The private descriptor, socket owner, mode, and fixed basename authenticate
      // the endpoint without assuming both processes resolve os.tmpdir() equally.
      if (!path.isAbsolute(value.endpoint) || !path.basename(value.endpoint).startsWith("bordeaux-mcp-") || !value.endpoint.endsWith(".sock")) throw new Error("The Bordeaux MCP endpoint is invalid.");
      const endpointStat = await fs.promises.lstat(value.endpoint);
      if (!endpointStat.isSocket() || (endpointStat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && endpointStat.uid !== process.getuid())) throw new Error("The Bordeaux MCP endpoint is not a private socket owned by this user.");
    }
    return value;
  }

  async request(request: AgentRequest, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new Error("Agent request was canceled.");
    const descriptor = await this.readDescriptor();
    if (signal?.aborted) throw new Error("Agent request was canceled.");
    const socket = net.createConnection(descriptor.endpoint);
    const onAbort = () => socket.destroy(new Error("Agent request was canceled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Could not connect to the Bordeaux MCP session.")), 2_000);
        socket.once("connect", () => { clearTimeout(timer); resolve(); });
        socket.once("error", (error) => { clearTimeout(timer); reject(error); });
      });
      const id = randomUUID();
      socket.write(encode({ id, token: descriptor.token, request } satisfies BridgeEnvelope));
      const response = await readOne(socket, REQUEST_TIMEOUT_MS) as { id?: string; result?: unknown; error?: string };
      if (response.error) throw new Error(response.error);
      if (response.id !== id) throw new Error("The Bordeaux MCP response did not match its request.");
      return response.result;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
    }
  }
}
