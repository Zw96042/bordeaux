import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverJavaProject } from "../src/electron/javaProject";

const directories: string[] = [];
async function project(sources: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-discovery-performance-"));
  directories.push(root);
  const sourceRoot = path.join(root, "src/main/java");
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.writeFile(path.join(root, "build.gradle"), "plugins { id 'java' }");
  await Promise.all(Object.entries(sources).map(([name, contents]) => fs.writeFile(path.join(sourceRoot, name), contents)));
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Java discovery performance regressions", () => {
  it("preserves source lines across comments, CRLF, constructors, and multiple top-level declarations", async () => {
    const lines = [
      "package robot;",
      "import edu.wpi.first.wpilibj2.command.Command;",
      "/* a comment",
      "   on two lines */",
      "public class Factory {",
      '  String text = """',
      "    public Command fake() {}",
      '    """;',
      "  public Command first() { return null; }",
      "  // another member",
      "  @BordeauxCommand",
      "  public Command second(int value) { return null; }",
      "}",
      "public class MoveCommand extends Command {",
      "  public MoveCommand(double speed) {}",
      "}",
      "public class ImplicitCommand extends Command {}",
    ];
    const catalog = await discoverJavaProject(await project({ "Commands.java": lines.join("\r\n") }));
    expect(Object.fromEntries(catalog.commands.map((command) => [command.member, command.source?.line]))).toEqual({
      first: 9, second: 11, MoveCommand: 15, ImplicitCommand: 17,
    });
  });

  it("resolves same-package and qualified types while keeping ambiguous simple names opaque", async () => {
    const catalog = await discoverJavaProject(await project({
      "A.java": "package a; record Config(double speed) {} public class Local { public Command run(Config config, b.Config other, Unique only, Config[] items) {} }",
      "B.java": "package b; record Config(boolean ready) {} record Unique(int level) {}",
      "C.java": "package c; public class Remote { public Command run(Config ambiguous, a.Config known, Unique only) {} }",
    }));
    const local = catalog.commands.find((command) => command.ownerType === "a.Local")!;
    expect(local.parameters.map((parameter) => parameter.schema)).toMatchObject([
      { kind: "object", javaType: "a.Config", fields: [{ name: "speed", schema: { kind: "number" } }] },
      { kind: "object", javaType: "b.Config", fields: [{ name: "ready", schema: { kind: "boolean" } }] },
      { kind: "object", javaType: "b.Unique" },
      { kind: "array", element: { kind: "object", javaType: "a.Config" } },
    ]);
    const remote = catalog.commands.find((command) => command.ownerType === "c.Remote")!;
    expect(remote.parameters.map((parameter) => parameter.schema)).toMatchObject([
      { kind: "opaque", javaType: "Config" },
      { kind: "object", javaType: "a.Config" },
      { kind: "object", javaType: "b.Unique" },
    ]);
  });

  it("preserves first declaration selection and cycle detection", async () => {
    const catalog = await discoverJavaProject(await project({
      "A.java": "package robot; record Config(double first) {} record Recursive(Recursive next) {} public class Factory { public Command run(Config config, Recursive recursive) {} }",
      "B.java": "package robot; record Config(boolean second) {}",
    }));
    expect(catalog.commands[0].parameters.map((parameter) => parameter.schema)).toMatchObject([
      { kind: "object", fields: [{ name: "first" }] },
      { kind: "object", fields: [{ name: "next", schema: { kind: "opaque", javaType: "robot.Recursive" } }] },
    ]);
  });

  it("overlaps source reads with a bounded batch and preserves deterministic discovery order", async () => {
    const root = await project(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [
      `Source${String(index).padStart(2, "0")}.java`,
      `package robot; public class Factory${index} { public Command run() {} }`,
    ])));
    const originalRead = fs.readFile.bind(fs);
    let active = 0;
    let peak = 0;
    vi.spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      if (!String(args[0]).endsWith(".java")) return originalRead(...args);
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return await originalRead(...args);
      } finally { active -= 1; }
    }) as typeof fs.readFile);
    const first = await discoverJavaProject(root);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(first.sourceFileCount).toBe(25);
    expect((await discoverJavaProject(root)).commands).toEqual(first.commands);
  });

  it("still rejects the total source budget before reading an overflowing batch", async () => {
    const root = await project(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [
      `Source${String(index).padStart(2, "0")}.java`, " ".repeat(512 * 1024),
    ])));
    const read = vi.spyOn(fs, "readFile");
    await expect(discoverJavaProject(root)).rejects.toThrow(/source exceeds.*scan limit/);
    expect(read.mock.calls.some(([name]) => String(name).endsWith("Source24.java"))).toBe(false);
  });

  it("propagates failed reads and permits a fresh scan after the file is repaired", async () => {
    const root = await project({ "Factory.java": "public class Factory { public Command run() {} }" });
    const originalRead = fs.readFile.bind(fs);
    const read = vi.spyOn(fs, "readFile").mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("Factory.java")) throw new Error("source read failed");
      return originalRead(...args);
    }) as typeof fs.readFile);
    await expect(discoverJavaProject(root)).rejects.toThrow("source read failed");
    read.mockRestore();
    expect((await discoverJavaProject(root)).commands).toHaveLength(1);
  });
});
