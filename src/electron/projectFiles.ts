import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BordeauxProject } from "../shared/types";
import { decodeProjectFile, encodeProjectFile } from "../shared/project/fileFormat";
import type { DecodedProjectFile } from "../shared/project/fileFormat";

const writeQueues = new Map<string, Promise<void>>();
const MAX_PROJECT_FILE_BYTES = 16 * 1024 * 1024;

export async function readProject(filePath: string): Promise<DecodedProjectFile> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Bordeaux project must be a regular file");
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw new Error("Bordeaux project exceeds the 16 MiB size limit");
  return decodeProjectFile(await fs.readFile(filePath, "utf8"));
}

export function saveTargetForOpenedProject(filePath: string, decoded: DecodedProjectFile): string | null {
  return decoded.migrated || /\.bordeaux\.json$/i.test(filePath) ? null : filePath;
}

async function replaceFile(filePath: string, contents: string | Uint8Array, exclusive = false): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, typeof contents === "string" ? { encoding: "utf8", flag: "wx" } : { flag: "wx" });
    if (exclusive) await fs.link(temporary, target);
    else await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeProject(filePath: string, value: unknown, exclusive = false): Promise<BordeauxProject> {
  const { project, contents } = encodeProjectFile(value);
  const target = path.resolve(filePath);
  const previous = writeQueues.get(target) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => replaceFile(target, contents, exclusive));
  writeQueues.set(target, write);
  try {
    await write;
    return project;
  } finally {
    if (writeQueues.get(target) === write) writeQueues.delete(target);
  }
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await replaceFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeBufferAtomically(filePath: string, value: Uint8Array): Promise<void> {
  await replaceFile(filePath, value);
}

export const PROJECT_EXTENSION = ".bordeaux";
const WORKSPACE_FILE = ".bordeaux-workspace.json";
const folderQueues = new Map<string, Promise<unknown>>();
interface FolderState { format: "bordeaux-folder/1"; projectPath: string | null; project: BordeauxProject; files: Record<string, string>; pendingFiles?: Record<string, string>; }

export function projectFileName(name: string): string {
  return `${name.replace(/\.bordeaux(?:\.json)?$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 120) || "Project"}${PROJECT_EXTENSION}`;
}

async function readFolderState(folder: string): Promise<FolderState | null> {
  const target = path.join(folder, WORKSPACE_FILE);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_FILE_BYTES * 2) throw new Error("Folder recovery file is not a valid regular file");
    const state = JSON.parse(await fs.readFile(target, "utf8")) as FolderState;
    if (state.format !== "bordeaux-folder/1" || !state.files || typeof state.files !== "object") throw new Error("This folder already contains an unrelated recovery file");
    state.project = encodeProjectFile(state.project).project;
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function openProjectFolder(folder: string): Promise<{ project: BordeauxProject | null; projectPath: string | null }> {
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Choose a regular project folder");
  const state = await readFolderState(folder);
  if (state) {
    const projectPath = state.projectPath && path.dirname(path.resolve(state.projectPath)) === path.resolve(folder) ? state.projectPath : null;
    if (projectPath) {
      try {
        const [projectStat, recoveryStat] = await Promise.all([fs.lstat(projectPath), fs.lstat(path.join(folder, WORKSPACE_FILE))]);
        if (projectStat.mtimeMs > recoveryStat.mtimeMs) return { project: (await readProject(projectPath)).project, projectPath };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { project: state.project, projectPath };
  }
  const files = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.bordeaux(?:\.json)?$/i.test(entry.name));
  if (files.length > 1) throw new Error("This folder contains several projects. Open the desired .bordeaux file instead.");
  if (!files.length) return { project: null, projectPath: null };
  const target = path.join(folder, files[0].name);
  const decoded = await readProject(target);
  return { project: decoded.project, projectPath: saveTargetForOpenedProject(target, decoded) };
}

function digest(contents: string): string { return createHash("sha256").update(contents).digest("hex"); }

// The complete recovery snapshot is committed before the individual documents.
// A failed mirror write therefore leaves the latest edit recoverable. Files not
// owned by the manifest, including externally changed files, are never replaced.
export async function autosaveProjectFolder(folder: string, value: unknown, projectPath: string | null, options: { allowRetarget?: boolean; createProject?: boolean } = {}): Promise<BordeauxProject> {
  const target = path.resolve(folder);
  const { project } = encodeProjectFile(value);
  const previous = folderQueues.get(target) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const folderStat = await fs.lstat(target);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new Error("Project folder must be a regular directory");
    if (projectPath && path.dirname(path.resolve(projectPath)) !== target) throw new Error("Project file must stay in the opened folder");
    const old = await readFolderState(target);
    if (!options.allowRetarget && old?.projectPath && projectPath && path.resolve(old.projectPath) !== path.resolve(projectPath)) throw new Error("This folder is already open for another Bordeaux project");
    const documents = [
      ...project.paths.map((item) => ({ directory: "Paths", extension: "path", item })),
      ...project.routines.map((item) => ({ directory: "Routines", extension: "routine", item })),
    ].map(({ directory, extension, item }) => {
      // IDs keep file locations stable when display names change.
      const file = `${directory}/${digest(item.id).slice(0, 24)}.${extension}`;
      return { file, contents: `${JSON.stringify(extension === "path" ? { version: "2.0", robot: project.robot, ...item } : { format: "bordeaux-routine/1", ...item }, null, 2)}\n` };
    });
    for (const directory of ["Paths", "Routines"]) {
      const destination = path.join(target, directory);
      await fs.mkdir(destination, { recursive: true });
      const stat = await fs.lstat(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${directory} must be a regular directory`);
    }
    const observedFiles = { ...old?.files };
    for (const document of documents) {
      try {
        const destination = path.join(target, document.file);
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_FILE_BYTES) throw new Error(`Cannot replace ${document.file}`);
        const existing = digest(await fs.readFile(destination, "utf8"));
        if (existing !== old?.files[document.file] && existing !== old?.pendingFiles?.[document.file] && existing !== digest(document.contents)) throw new Error(`${document.file} changed outside Bordeaux. Preserve or rename it before saving again.`);
        observedFiles[document.file] = existing;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    // Retain hashes of removed entries so undo may recover their file. No local
    // deletion propagates into the folder or onto a robot.
    const files = { ...old?.files, ...Object.fromEntries(documents.map((item) => [item.file, digest(item.contents)])) };
    const state: FolderState = { format: "bordeaux-folder/1", projectPath, project, files };
    // Keep both previous and intended hashes if a mirror fails mid-save: recovery
    // loading remains authoritative and a subsequent autosave can finish safely.
    if (projectPath && options.createProject) await writeProject(projectPath, project, true);
    await writeJsonAtomically(path.join(target, WORKSPACE_FILE), { ...state, files: observedFiles, pendingFiles: files });
    for (const document of documents) await replaceFile(path.join(target, document.file), document.contents);
    await writeJsonAtomically(path.join(target, WORKSPACE_FILE), state);
    if (projectPath && !options.createProject) await writeProject(projectPath, project);
    return project;
  });
  folderQueues.set(target, pending);
  try { return await pending; } finally { if (folderQueues.get(target) === pending) folderQueues.delete(target); }
}
