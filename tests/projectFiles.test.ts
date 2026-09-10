import fs from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankPath, createDemoProject } from "../src/shared/project/defaults";
import { decodeProjectFile, encodeProjectFile, prepareProjectFile } from "../src/shared/project/fileFormat";
import type { BordeauxProject, CommandArgumentValue } from "../src/shared/types";
import { MAX_PROJECT_FILE_BYTES, MAX_WORKSPACE_FILE_BYTES, autosaveProjectFolder, openProjectFolder, projectFileName, projectWorkspacePath, readProject, writeBufferAtomically, writeProject } from "../src/electron/projectFiles";

const directories: string[] = [];
async function folder() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-files-")); directories.push(directory); return directory; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

const caseInsensitiveTemp = (() => {
  const probe = mkdtempSync(path.join(os.tmpdir(), "bordeaux-case-"));
  try { writeFileSync(path.join(probe, "a"), ""); return existsSync(path.join(probe, "A")); }
  finally { rmSync(probe, { recursive: true, force: true }); }
})();

function manyPaths(count: number): BordeauxProject {
  const project = createDemoProject();
  project.paths = Array.from({ length: count }, (_, index) => blankPath(`Path ${index + 1}`));
  project.editor = { ...project.editor, activePathId: project.paths[0].id };
  return project;
}

// One string argument per path makes saved files grow byte for byte with its length.
function withPayload(project: BordeauxProject, blobs: readonly string[]): BordeauxProject {
  const next = structuredClone(project);
  blobs.forEach((blob, index) => { next.paths[index].markers = [{ id: `payload-${index}`, f: 0.5, name: "Payload", invocation: { commandId: "Payload", arguments: { blob } } }]; });
  return next;
}
const payloadLengths = (project: BordeauxProject | null) => project?.paths.map((item) => String(item.markers[0]?.invocation?.arguments.blob ?? "").length);

async function folderDigests(directory: string) {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    result[path.relative(directory, file)] = createHash("sha256").update(await fs.readFile(file)).digest("hex");
  }
  return result;
}

async function identities(directory: string) {
  const result: Record<string, { ino: bigint; mtimeNs: bigint; bytes: string }> = {};
  for (const subfolder of ["Paths", "Routines"]) {
    for (const name of await fs.readdir(path.join(directory, subfolder))) {
      const file = path.join(directory, subfolder, name);
      const stat = await fs.stat(file, { bigint: true });
      result[`${subfolder}/${name}`] = { ino: stat.ino, mtimeNs: stat.mtimeNs, bytes: await fs.readFile(file, "utf8") };
    }
  }
  return result;
}

describe("managed document persistence", () => {
  it("keeps unchanged documents in place when one path is renamed", async () => {
    const directory = await folder(), project = manyPaths(21);
    await autosaveProjectFolder(directory, project, null);
    const before = await identities(directory);
    project.paths[0].name = "Renamed";
    await autosaveProjectFolder(directory, project, null);
    const after = await identities(directory);

    const unchanged = Object.keys(before).filter((file) => file !== "Paths/Path 1.path");
    expect(unchanged).toHaveLength(21);
    for (const file of unchanged) expect(after[file]).toEqual(before[file]);
    expect(after["Paths/Path 1.path"]).toBeUndefined();
    expect(JSON.parse(after["Paths/Renamed.path"].bytes).name).toBe("Renamed");
  });

  it("replaces only documents whose contents changed", async () => {
    const directory = await folder(), project = manyPaths(3);
    await autosaveProjectFolder(directory, project, null);
    const before = await identities(directory);
    project.paths[1].constraints.maxVel = 0.5;
    await autosaveProjectFolder(directory, project, null);
    const after = await identities(directory);

    expect(after["Paths/Path 2.path"].ino).not.toBe(before["Paths/Path 2.path"].ino);
    expect(JSON.parse(after["Paths/Path 2.path"].bytes).constraints.maxVel).toBe(0.5);
    expect(after["Paths/Path 1.path"]).toEqual(before["Paths/Path 1.path"]);
    expect(after["Paths/Path 3.path"]).toEqual(before["Paths/Path 3.path"]);
    expect((await openProjectFolder(directory)).project?.paths[1].constraints.maxVel).toBe(0.5);
  });

  it("rejects external edits to unchanged documents and preserves their bytes", async () => {
    const directory = await folder(), project = manyPaths(2);
    await autosaveProjectFolder(directory, project, null);
    const file = path.join(directory, "Paths/Path 2.path");
    await fs.writeFile(file, "external before save");
    project.paths[0].name = "Renamed";
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("changed outside");
    expect(await fs.readFile(file, "utf8")).toBe("external before save");
  });

  it("detects an unchanged document edited while its save is journaled", async () => {
    const directory = await folder(), project = manyPaths(2);
    await autosaveProjectFolder(directory, project, null);
    const file = path.join(directory, "Paths/Path 2.path");
    const writeFile = fs.writeFile.bind(fs); let edit = true;
    vi.spyOn(fs, "writeFile").mockImplementation(async (target, data, options) => {
      await writeFile(target, data, options);
      if (edit && String(target).includes(".bordeaux-workspace.json")) { edit = false; await writeFile(file, "external during save"); }
    });
    project.paths[0].constraints.maxVel = 0.5;
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("changed outside Bordeaux while saving");
    expect(await fs.readFile(file, "utf8")).toBe("external during save");
  });

  it("does not follow a symlink holding a document's unchanged bytes", async () => {
    const directory = await folder(), outside = await folder(), project = manyPaths(1);
    await autosaveProjectFolder(directory, project, null);
    const file = path.join(directory, "Paths/Path 1.path"), outsideFile = path.join(outside, "Copy.path");
    await fs.copyFile(file, outsideFile);
    await fs.rm(file); await fs.symlink(outsideFile, file);
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("Cannot replace");
    expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
  });

  it("retries an interrupted save, keeping documents written before the interruption", async () => {
    const directory = await folder(), project = manyPaths(3);
    await autosaveProjectFolder(directory, project, null);
    project.paths[0].constraints.maxVel = 0.5; project.paths[1].constraints.maxVel = 0.6;
    const rename = fs.rename.bind(fs); let fail = true;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (fail && String(to).endsWith("Path 2.path")) { fail = false; throw new Error("disk interrupted"); }
      return rename(from, to);
    });
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("disk interrupted");
    const interrupted = await identities(directory);
    expect(JSON.parse(interrupted["Paths/Path 1.path"].bytes).constraints.maxVel).toBe(0.5);

    await autosaveProjectFolder(directory, project, null);
    const retried = await identities(directory);
    // The pending journal owns the already written replacement, so it stays in place.
    expect(retried["Paths/Path 1.path"]).toEqual(interrupted["Paths/Path 1.path"]);
    expect(retried["Paths/Path 3.path"]).toEqual(interrupted["Paths/Path 3.path"]);
    expect(JSON.parse(retried["Paths/Path 2.path"].bytes).constraints.maxVel).toBe(0.6);
    const state = JSON.parse(await fs.readFile(projectWorkspacePath(directory), "utf8"));
    expect(state.pendingFiles).toBeUndefined();
  });

  it("applies queued saves in order, including a revert to earlier contents", async () => {
    const directory = await folder(), project = manyPaths(3);
    await autosaveProjectFolder(directory, project, null);
    const before = await identities(directory);
    const edited = structuredClone(project); edited.paths[0].constraints.maxVel = 0.5;
    await Promise.all([
      autosaveProjectFolder(directory, edited, null),
      autosaveProjectFolder(directory, project, null),
    ]);
    const after = await identities(directory);
    expect(after["Paths/Path 1.path"].bytes).toBe(before["Paths/Path 1.path"].bytes);
    expect(after["Paths/Path 2.path"]).toEqual(before["Paths/Path 2.path"]);
    expect((await openProjectFolder(directory)).project?.paths[0].constraints.maxVel).toBe(project.paths[0].constraints.maxVel);
  });

  it.runIf(caseInsensitiveTemp)("completes an interrupted case-only rename whose contents are already written", async () => {
    const directory = await folder(), project = createDemoProject();
    project.routines[0].name = "CaseTest";
    await autosaveProjectFolder(directory, project, null);
    project.routines[0].name = "casetest";
    const rename = fs.rename.bind(fs); let fail = true;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (fail && String(from).endsWith("Routines/CaseTest.routine")) { fail = false; throw new Error("disk interrupted"); }
      return rename(from, to);
    });
    await expect(autosaveProjectFolder(directory, project, null)).rejects.toThrow("disk interrupted");
    await autosaveProjectFolder(directory, project, null);
    expect(await fs.readdir(path.join(directory, "Routines"))).toEqual(["casetest.routine"]);
    expect(JSON.parse(await fs.readFile(path.join(directory, "Routines/casetest.routine"), "utf8")).name).toBe("casetest");
  });
});

describe("project preparation without serialization", () => {
  it("matches the encoded project, strips editor state, and keeps validation", () => {
    const { schemaVersion: _unversioned, ...project } = createDemoProject();
    const withEditorState = { ...project, paths: project.paths.map((item) => ({ ...item, _selT: 0.5 })) };
    const prepared = prepareProjectFile(withEditorState);
    expect(prepared).toEqual(encodeProjectFile(withEditorState).project);
    expect(prepared.schemaVersion).toBe("1.0");
    expect(prepared.paths[0]).not.toHaveProperty("_selT");
    expect(() => prepareProjectFile({ ...project, schemaVersion: "9.0" })).toThrow("Unsupported Bordeaux project schema version");
    expect(() => prepareProjectFile({ ...project, field: { ...project.field, id: "other" } })).toThrow("field compatibility");
  });

  it("keeps command arguments named like editor state while omitting path selection state", async () => {
    const args: Record<string, CommandArgumentValue> = {
      _selT: 0.25, _selAfter: [{ _selM: "keep", _selR: null }, [{ _selT: { deep: true } }]],
      nested: { _selR: { _selAfter: 3 }, list: [1, "two", { _selM: false }] },
    };
    const project = createDemoProject();
    project.paths[0].markers.push({ id: "event-1", f: 0.5, name: "Shoot", invocation: { commandId: "Shooter.Fire", arguments: structuredClone(args) } });
    project.routines[0].nodes.push({ id: "node-1", type: "function", cat: "command", invocation: { commandId: "Intake.Run", arguments: structuredClone(args) } });
    const edited = { ...project, paths: project.paths.map((item) => ({ ...item, _selAfter: 1, _selT: 0, _selM: 0, _selR: 0 })) };
    const expectSaved = (saved: BordeauxProject) => {
      for (const key of ["_selAfter", "_selT", "_selM", "_selR"]) expect(saved.paths[0]).not.toHaveProperty(key);
      expect(saved.paths[0].markers[0].invocation?.arguments).toEqual(args);
      expect(saved.routines[0].nodes[0]).toMatchObject({ invocation: { arguments: args } });
    };

    expectSaved(prepareProjectFile(edited));
    expectSaved(decodeProjectFile(encodeProjectFile(edited).contents).project);
    const directory = await folder();
    await writeProject(path.join(directory, "Standalone.bordeaux"), edited);
    expectSaved((await readProject(path.join(directory, "Standalone.bordeaux"))).project);
    await autosaveProjectFolder(directory, edited, null);
    expectSaved((await openProjectFolder(directory)).project!);
    // A browser path document is itself the path record.
    const browserPath = decodeProjectFile(JSON.stringify({ version: "2.0", robot: project.robot, ...edited.paths[0] })).project.paths[0];
    for (const key of ["_selAfter", "_selT", "_selM", "_selR"]) expect(browserPath).not.toHaveProperty(key);
    expect(browserPath.markers[0].invocation?.arguments).toEqual(args);
  });

  it("still validates the recovery workspace project on open", async () => {
    const directory = await folder();
    await autosaveProjectFolder(directory, createDemoProject(), null);
    const state = JSON.parse(await fs.readFile(projectWorkspacePath(directory), "utf8"));
    await fs.writeFile(projectWorkspacePath(directory), JSON.stringify({ ...state, project: { ...state.project, schemaVersion: "9.0" } }));
    await expect(openProjectFolder(directory)).rejects.toThrow("Unsupported Bordeaux project schema version");
  });
});
