import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentBridgeServer } from "../src/electron/agentBridge";
import { AgentSessionService } from "../src/electron/agentSession";

const directories: string[] = [];
const bridges: AgentBridgeServer[] = [];

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-bridge-lifecycle-"));
  directories.push(directory);
  const bridge = new AgentBridgeServer(directory, new AgentSessionService(() => {}, () => null));
  bridges.push(bridge);
  return { directory, bridge };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("agent bridge lifecycle", () => {
  it("shares one listener and descriptor between concurrent starts", async () => {
    const { bridge } = await fixture();
    const createServer = vi.spyOn(net, "createServer");

    const [first, second] = await Promise.all([bridge.start(), bridge.start()]);

    expect(first).toEqual(second);
    expect(createServer).toHaveBeenCalledTimes(1);
    expect(bridge.enabled).toBe(true);
  });

  it("closes the listener and removes temporary files when descriptor publication fails", async () => {
    const { directory, bridge } = await fixture();
    const createServer = vi.spyOn(net, "createServer");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("Descriptor publication failed"));

    await expect(bridge.start()).rejects.toThrow("Descriptor publication failed");

    expect(createServer.mock.results[0].value.listening).toBe(false);
    expect(bridge.enabled).toBe(false);
    expect(await fs.readdir(path.join(directory, "mcp"))).toEqual([]);
    await expect(bridge.start()).resolves.toMatchObject({ protocolVersion: 1 });
    expect(bridge.enabled).toBe(true);
  });

  it("finishes startup cleanup when stopped during descriptor publication", async () => {
    const { directory, bridge } = await fixture();
    const starting = bridge.start();
    const stopping = bridge.stop();

    const descriptor = await starting;
    await stopping;

    expect(bridge.enabled).toBe(false);
    await expect(fs.stat(path.join(directory, "mcp", "runtime-v1.json"))).rejects.toMatchObject({ code: "ENOENT" });
    if (process.platform !== "win32") await expect(fs.stat(descriptor.endpoint)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(bridge.start()).resolves.toMatchObject({ protocolVersion: 1 });
  });
});
