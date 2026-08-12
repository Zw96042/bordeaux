import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { quitAfterMcpInputEnds } from "../src/electron/mcpStdioLifecycle";

describe("MCP stdio lifecycle", () => {
  it("closes the server and quits once when stdin ends", async () => {
    const input = new PassThrough();
    const closeServer = vi.fn(async () => undefined);
    const quit = vi.fn();
    const reportError = vi.fn();
    quitAfterMcpInputEnds(input, closeServer, quit, reportError);

    input.resume();
    input.end();
    await new Promise((resolve) => setImmediate(resolve));

    expect(closeServer).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });
});
