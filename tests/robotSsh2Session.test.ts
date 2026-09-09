import { describe, expect, it, vi } from "vitest";
import { connectRobotSftp } from "../src/electron/robotSsh2Session";
import type { RobotRemoteFile } from "../src/electron/robotSftpTransport";

const mock = vi.hoisted(() => ({ sftp: {} as Record<string, unknown> }));
vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events");
  return { Client: class extends EventEmitter {
    connect(options: { hostVerifier: (key: Buffer) => boolean }) {
      if (!options.hostVerifier(Buffer.from("host key"))) this.emit("error", new Error("Rejected host"));
      else queueMicrotask(() => this.emit("ready"));
    }
    sftp(callback: (error: null, sftp: unknown) => void) { callback(null, mock.sftp); }
    end() {}
    destroy() {}
  } };
});

function setup(entries: Record<string, "dir" | "link" | "file">) {
  const mkdir = vi.fn((target: string, _options: unknown, callback: (error?: Error) => void) => { entries[target] = "dir"; callback(); });
  mock.sftp = {
    lstat: vi.fn((target: string, callback: (error: unknown, stat?: unknown) => void) => {
      const kind = entries[target];
      if (!kind) callback({ code: 2 });
      else callback(null, { isDirectory: () => kind === "dir", isSymbolicLink: () => kind === "link", isFile: () => kind === "file" });
    }),
    mkdir,
    writeFile: vi.fn((_target: string, _bytes: Buffer, _options: unknown, callback: () => void) => callback()),
    ext_openssh_rename: vi.fn((_from: string, _to: string, callback: () => void) => callback()),
    end: vi.fn(),
  };
  return { mkdir };
}
const signal = new AbortController().signal;
const connect = () => connectRobotSftp({ endpoint: { host: "robot.local", port: 22 }, credentials: { password: "" }, signal, timeoutMs: 2000 });

describe("direct file SSH session confinement", () => {
  it("keeps probe read-only when the Paths directory is absent, then creates it only on upload", async () => {
    const f = setup({ "/natinst": "dir", "/natinst/bin": "dir" });
    const session = await connect();
    try {
      await session.ensureDirectory!("/natinst/bin/Paths", false, signal);
      expect(f.mkdir).not.toHaveBeenCalled();
      await session.ensureDirectory!("/natinst/bin/Paths", true, signal);
      expect(f.mkdir).toHaveBeenCalledWith("/natinst/bin/Paths", { mode: 0o755 }, expect.any(Function));
    } finally { await session.close(); }
  });

  it.each(["link", "file"] as const)("rejects a %s in destination ancestry", async (kind) => {
    setup({ "/natinst": "dir", "/natinst/bin": kind });
    const session = await connect();
    try { await expect(session.ensureDirectory!("/natinst/bin/Paths", true, signal)).rejects.toThrow("non-directory or symbolic link"); }
    finally { await session.close(); }
  });

  it("uses exclusive writes and the atomic rename extension within the reviewed directory", async () => {
    setup({});
    const session = await connect();
    const temporary: RobotRemoteFile = { kind: "pathTemporary", directory: "/natinst/bin/Paths", fileName: "one.bdx", token: "a".repeat(32) };
    const destination: RobotRemoteFile = { kind: "pathFile", directory: temporary.directory, fileName: temporary.fileName };
    try {
      await session.write(temporary, Buffer.from("bdx"), signal);
      expect(mock.sftp.writeFile).toHaveBeenCalledWith(`/natinst/bin/Paths/.bordeaux-one.bdx-${"a".repeat(32)}.tmp`, Buffer.from("bdx"), { flag: "wx", mode: 0o600 }, expect.any(Function));
      await session.renameSameDirectory(temporary, destination, signal);
      expect(mock.sftp.ext_openssh_rename).toHaveBeenCalledOnce();
      expect(() => session.renameSameDirectory(temporary, { ...destination, directory: "/home/lvuser" }, signal)).toThrow();
      expect(() => session.write(destination, Buffer.from("bdx"), signal)).toThrow();
    } finally { await session.close(); }
  });

  it("rejects a symlink at the selected filename instead of overwriting it", async () => {
    setup({ "/natinst/bin/Paths/one.bdx": "link" });
    const session = await connect();
    try { await expect(session.exists({ kind: "pathFile", directory: "/natinst/bin/Paths", fileName: "one.bdx" }, signal)).rejects.toThrow("not a regular file"); }
    finally { await session.close(); }
  });
});
