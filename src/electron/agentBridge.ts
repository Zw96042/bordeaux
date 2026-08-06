import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AgentRequest, AgentSessionService } from "./agentSession";

const MAX_MESSAGE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

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

function encode(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > MAX_MESSAGE_BYTES) throw new Error("Agent bridge message exceeds 1 MiB");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function readOne(socket: net.Socket, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("Agent bridge request timed out")), timeoutMs);
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      error ? reject(error) : resolve(value);
    };
    const onError = (error: Error) => finish(error);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32BE(0);
      if (size < 2 || size > MAX_MESSAGE_BYTES) return finish(new Error("Agent bridge frame size is invalid"));
      if (buffer.length < size + 4) return;
      try { finish(undefined, JSON.parse(buffer.subarray(4, size + 4).toString("utf8"))); }
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

  constructor(private readonly userData: string, private readonly sessions: AgentSessionService) {}

  get enabled(): boolean { return this.server !== null; }

  async start(): Promise<AgentRuntimeDescriptor> {
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
      socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
