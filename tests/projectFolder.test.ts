import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankPath, createDemoProject } from "../src/shared/project/defaults";
import { autosaveProjectFolder, openProjectFolder, projectFileName, readProject } from "../src/electron/projectFiles";
const directories: string[] = [];
async function folder() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-folder-")); directories.push(directory); return directory; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });
describe("folder projects", () => {
  it("opens an empty folder without creating a project until Save", async () => {
    const directory = await folder();
    expect(await openProjectFolder(directory)).toEqual({ project: null, projectPath: null });
    const project = createDemoProject();
    await autosaveProjectFolder(directory, project, null);
    expect((await fs.readdir(directory)).some((name) => name.endsWith(".bordeaux"))).toBe(false);
    expect((await fs.readdir(path.join(directory, "Paths")))).toHaveLength(1);
    expect((await fs.readdir(path.join(directory, "Routines")))).toHaveLength(1);
    expect((await openProjectFolder(directory)).project).toEqual(project);
    const target = path.join(directory, projectFileName("Test"));
    await autosaveProjectFolder(directory, project, target);
    expect((await readProject(target)).project).toEqual(project);
  });
  it("autosaves path and routine edits and names into stable document files", async () => {
    const directory = await folder(); const project = createDemoProject();
    await autosaveProjectFolder(directory, project, null);
    const paths = await fs.readdir(path.join(directory, "Paths"));
    project.paths[0].name = "Renamed path"; project.routines[0].name = "Renamed routine";
    await autosaveProjectFolder(directory, project, null);
    expect(await fs.readdir(path.join(directory, "Paths"))).toEqual(paths);
    expect(JSON.parse(await fs.readFile(path.join(directory, "Paths", paths[0]), "utf8")).name).toBe("Renamed path");
    expect((await openProjectFolder(directory)).project?.routines[0].name).toBe("Renamed routine");
  });
  it("preserves externally changed files and reports the conflict", async () => {
    const directory = await folder(); const project = createDemoProject();
    await autosaveProjectFolder(directory, project, null);
    const file = path.join(directory, "Paths", (await fs.readdir(path.join(directory, "Paths")))[0]);
    await fs.writeFile(file, "external changes");
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("changed outside");
    expect(await fs.readFile(file, "utf8")).toBe("external changes");
  });
  it("rejects unrelated recovery files and linked document directories", async () => {
    const directory = await folder(); await fs.writeFile(path.join(directory, ".bordeaux-workspace.json"), '{}');
    await expect(openProjectFolder(directory)).rejects.toThrow("unrelated recovery");
    const other = await folder(); const outside = await folder();
    await fs.symlink(outside, path.join(other, "Paths"));
    await expect(autosaveProjectFolder(other, createDemoProject(), null)).rejects.toThrow("regular directory");
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("serializes overlapping saves and preserves removed documents without restoring them", async () => {
    const directory = await folder(); const first = createDemoProject();
    const second = structuredClone(first); second.paths[0].name = "Newest";
    await Promise.all([autosaveProjectFolder(directory, first, null), autosaveProjectFolder(directory, second, null)]);
    expect((await openProjectFolder(directory)).project?.paths[0].name).toBe("Newest");
    const mirror = path.join(directory, "Paths", (await fs.readdir(path.join(directory, "Paths")))[0]);
    expect((await readProject(mirror)).project.paths[0].name).toBe("Newest");
    second.paths = [blankPath("Replacement")];
    second.editor = { ...second.editor, activePathId: second.paths[0].id };
    await autosaveProjectFolder(directory, second, null);
    expect((await openProjectFolder(directory)).project?.paths.map((item) => item.name)).toEqual(["Replacement"]);
    expect(await fs.stat(mirror)).toBeTruthy();
  });
  it("never replaces a colliding newly created project and supports explicit Save As", async () => {
    const directory = await folder(); const project = createDemoProject();
    const first = path.join(directory, "First.bordeaux");
    await fs.writeFile(first, "unrelated");
    await expect(autosaveProjectFolder(directory, project, first, { createProject: true })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(first, "utf8")).toBe("unrelated");
    await fs.rm(first);
    await autosaveProjectFolder(directory, project, first, { createProject: true });
    const second = path.join(directory, "Second.bordeaux");
    await expect(autosaveProjectFolder(directory, project, second)).rejects.toThrow("another Bordeaux project");
    await autosaveProjectFolder(directory, project, second, { allowRetarget: true, createProject: true });
    expect((await openProjectFolder(directory)).projectPath).toBe(second);
    expect((await readProject(first)).project).toEqual(project);
  });
  it("recovers a partial mirror write and accepts the next different edit", async () => {
    const directory = await folder(); const project = createDemoProject();
    await autosaveProjectFolder(directory, project, null);
    project.paths[0].name = "First edit";
    const rename = fs.rename.bind(fs); let fail = true;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".routine") && fail) { fail = false; throw new Error("disk interrupted"); }
      return rename(from, to);
    });
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("disk interrupted");
    expect((await openProjectFolder(directory)).project?.paths[0].name).toBe("First edit");
    project.paths[0].name = "Next edit";
    await autosaveProjectFolder(directory, project, null);
    expect((await openProjectFolder(directory)).project?.paths[0].name).toBe("Next edit");
  });
  it("uses .bordeaux and sanitizes suggested file names", () => {
    expect(projectFileName("Robot.bordeaux.json")).toBe("Robot.bordeaux");
    expect(projectFileName("../Robot")).toBe("..-Robot.bordeaux");
  });
});
