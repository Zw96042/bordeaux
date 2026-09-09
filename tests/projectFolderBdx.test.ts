import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoProject } from "../src/shared/project/defaults";
import { autosaveProjectFolder, openProjectFolder, writeProjectFolderBdx } from "../src/electron/projectFiles";

const directories: string[] = [];
async function folder() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-bdx-folder-"));
  directories.push(directory);
  await autosaveProjectFolder(directory, createDemoProject(), null);
  return directory;
}
const output = (fileName = "Test.bdx", content = "first") => ({ fileName, bytes: Buffer.from(content) });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("folder BDX generation", () => {
  it("writes exact binary bytes only on explicit generation and preserves ownership across autosaves", async () => {
    const directory = await folder();
    expect((await fs.readdir(path.join(directory, "Paths"))).filter((name) => name.endsWith(".bdx"))).toEqual([]);
    const bytes = Buffer.from([0, 255, 128, 10]);
    await writeProjectFolderBdx(directory, [{ fileName: "Test.bdx", bytes }]);
    expect(await fs.readFile(path.join(directory, "Paths/Test.bdx"))).toEqual(bytes);
    await autosaveProjectFolder(directory, createDemoProject(), null);
    await writeProjectFolderBdx(directory, [output("Test.bdx", "new")]);
    expect(await fs.readFile(path.join(directory, "Paths/Test.bdx"), "utf8")).toBe("new");
  });

  it("preserves unrelated and externally changed outputs, including identical unrelated bytes", async () => {
    const directory = await folder();
    const destination = path.join(directory, "Paths/Test.bdx");
    await fs.writeFile(destination, "first");
    await expect(writeProjectFolderBdx(directory, [output()])).rejects.toThrow("unrelated or changed outside");
    await fs.rm(destination);
    await writeProjectFolderBdx(directory, [output()]);
    await fs.writeFile(destination, "external");
    await expect(writeProjectFolderBdx(directory, [output("Test.bdx", "new")])).rejects.toThrow("changed outside");
    expect(await fs.readFile(destination, "utf8")).toBe("external");
  });

  it("preflights every output before writing and retains saved source after a conflict", async () => {
    const directory = await folder();
    await fs.writeFile(path.join(directory, "Paths/Other.bdx"), "unrelated");
    const project = createDemoProject(); project.paths[0].name = "Latest edit";
    await autosaveProjectFolder(directory, project, null);
    await expect(writeProjectFolderBdx(directory, [output(), output("Other.bdx")])).rejects.toThrow("unrelated");
    await expect(fs.stat(path.join(directory, "Paths/Test.bdx"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await openProjectFolder(directory)).project?.paths[0].name).toBe("Latest edit");
  });

  it("rejects path traversal, duplicate names, and linked output files or directories", async () => {
    const directory = await folder(); const outside = await folder();
    await expect(writeProjectFolderBdx(directory, [output("../Escape.bdx")])).rejects.toThrow("plain .bdx filename");
    await expect(writeProjectFolderBdx(directory, [output(), output("test.BDX")])).rejects.toThrow("Duplicate");
    await fs.writeFile(path.join(outside, "Test.bdx"), "outside");
    await fs.symlink(path.join(outside, "Test.bdx"), path.join(directory, "Paths/Test.bdx"));
    await expect(writeProjectFolderBdx(directory, [output()])).rejects.toThrow("regular file");
    await fs.rm(path.join(directory, "Paths"), { recursive: true });
    await fs.symlink(outside, path.join(directory, "Paths"));
    await expect(writeProjectFolderBdx(directory, [output()])).rejects.toThrow("regular directory");
    expect(await fs.readFile(path.join(outside, "Test.bdx"), "utf8")).toBe("outside");
  });

  it("recovers interrupted output writes even after autosaving another source edit", async () => {
    const directory = await folder();
    await writeProjectFolderBdx(directory, [output(), output("Other.bdx")]);
    const rename = fs.rename.bind(fs); let fail = true;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith("Other.bdx") && fail) { fail = false; throw new Error("disk interrupted"); }
      return rename(from, to);
    });
    await expect(writeProjectFolderBdx(directory, [output("Test.bdx", "second"), output("Other.bdx", "second")])).rejects.toThrow("disk interrupted");
    await autosaveProjectFolder(directory, createDemoProject(), null);
    await writeProjectFolderBdx(directory, [output("Test.bdx", "third"), output("Other.bdx", "third")]);
    expect(await fs.readFile(path.join(directory, "Paths/Test.bdx"), "utf8")).toBe("third");
    expect(await fs.readFile(path.join(directory, "Paths/Other.bdx"), "utf8")).toBe("third");
    const manifest = JSON.parse(await fs.readFile(path.join(directory, ".bordeaux-workspace.json"), "utf8"));
    expect(manifest.pendingGeneratedFiles).toBeUndefined();
  });

  it("serializes outputs with source autosaves and preserves removed outputs", async () => {
    const directory = await folder(); const project = createDemoProject(); project.paths[0].name = "Next edit";
    await Promise.all([
      writeProjectFolderBdx(directory, [output()]),
      autosaveProjectFolder(directory, project, null),
      writeProjectFolderBdx(directory, [output("Test.bdx", "latest")]),
    ]);
    expect((await openProjectFolder(directory)).project?.paths[0].name).toBe("Next edit");
    await writeProjectFolderBdx(directory, []);
    expect(await fs.readFile(path.join(directory, "Paths/Test.bdx"), "utf8")).toBe("latest");
  });
});
