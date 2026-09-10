import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BordeauxProject } from "../shared/types";
import { decodeProjectFile, encodeProjectFile, prepareProjectFile } from "../shared/project/fileFormat";
import type { DecodedProjectFile } from "../shared/project/fileFormat";
import { MAX_FILE_NAME_BYTES, portableFileStem, truncateUtf8 } from "../shared/portableFileName";

const writeQueues = new Map<string, Promise<void>>();
const openedProjectHashes = new Map<string, string>();
export const MAX_PROJECT_FILE_BYTES = 16 * 1024 * 1024;
/** A workspace holds the whole project plus its file ownership records. */
export const MAX_WORKSPACE_FILE_BYTES = MAX_PROJECT_FILE_BYTES * 2;

export async function readProject(filePath: string): Promise<DecodedProjectFile> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Bordeaux project must be a regular file");
  const maxBytes = path.basename(filePath) === PROJECT_WORKSPACE_FILE ? MAX_WORKSPACE_FILE_BYTES : MAX_PROJECT_FILE_BYTES;
  if (stat.size > maxBytes) throw new Error(`Bordeaux project exceeds the ${maxBytes / 1024 / 1024} MiB size limit`);
  if (path.basename(filePath) === PROJECT_WORKSPACE_FILE) {
    const state = await readFolderState(path.dirname(filePath));
    if (!state) throw new Error("Project workspace is missing");
    return { project: { ...state.project, name: path.basename(path.dirname(path.resolve(filePath))) }, migrated: false };
  }
  const contents = await fs.readFile(filePath, "utf8");
  const decoded = decodeProjectFile(contents);
  openedProjectHashes.set(path.resolve(filePath), digest(contents));
  return decoded;
}

export function saveTargetForOpenedProject(filePath: string, decoded: DecodedProjectFile): string | null {
  return decoded.migrated || /\.bordeaux\.json$/i.test(filePath) ? null : filePath;
}

async function replaceFile(filePath: string, contents: string | Uint8Array, exclusive = false): Promise<void> {
  const target = path.resolve(filePath);
  // At most 100 + 42 bytes, so any target name that fits also has a temporary name that fits.
  const temporary = path.join(path.dirname(target), `.${truncateUtf8(path.basename(target), 100)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, typeof contents === "string" ? { encoding: "utf8", flag: "wx" } : { flag: "wx" });
    if (exclusive) await fs.link(temporary, target);
    else await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function jsonContents(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

// Readers refuse larger files, so writing one would strand the project at its
// next open or save. Checked against the exact UTF-8 bytes before any write.
function withinReadLimit(contents: string, maxBytes: number, label: string): string {
  const bytes = Buffer.byteLength(contents, "utf8");
  if (bytes <= maxBytes) return contents;
  const needed = Math.ceil(bytes / (1024 * 1024) * 10) / 10;
  throw new Error(`${label} would be ${needed} MiB, over the ${maxBytes / 1024 / 1024} MiB limit Bordeaux can reopen, so nothing was saved. Split the project or remove unused paths and routines, then save again.`);
}

function workspaceContents(state: FolderState): string {
  return withinReadLimit(jsonContents(state), MAX_WORKSPACE_FILE_BYTES, "The project workspace");
}

export async function writeProject(filePath: string, value: unknown, exclusive = false): Promise<BordeauxProject> {
  const { project, contents } = encodeProjectFile(value);
  withinReadLimit(contents, MAX_PROJECT_FILE_BYTES, path.basename(filePath));
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
  await replaceFile(filePath, jsonContents(value));
}

export async function writeBufferAtomically(filePath: string, value: Uint8Array): Promise<void> {
  await replaceFile(filePath, value);
}

export const PROJECT_EXTENSION = ".bordeaux";
export const PROJECT_WORKSPACE_FILE = ".bordeaux-workspace.json";
export function projectWorkspacePath(folder: string): string { return path.join(path.resolve(folder), PROJECT_WORKSPACE_FILE); }
const folderQueues = new Map<string, Promise<unknown>>();
interface FolderState { format: "bordeaux-folder/1"; projectPath: string | null; project: BordeauxProject; files: Record<string, string>; pendingFiles?: Record<string, string>; generatedFiles?: Record<string, string>; pendingGeneratedFiles?: Record<string, string>; documentFiles?: Record<string, string>; legacyProjectMirror?: { file: string; hash: string }; importedFrom?: { file: string; hash: string }; }

export function projectFileName(name: string): string {
  const stem = name.replace(/\.bordeaux(?:\.json)?$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 120) || "Project";
  return `${portableFileStem(stem, MAX_FILE_NAME_BYTES - PROJECT_EXTENSION.length)}${PROJECT_EXTENSION}`;
}

async function readFolderState(folder: string): Promise<FolderState | null> {
  const target = path.join(folder, PROJECT_WORKSPACE_FILE);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_WORKSPACE_FILE_BYTES) throw new Error("Folder recovery file is not a valid regular file");
    const state = JSON.parse(await fs.readFile(target, "utf8")) as FolderState;
    if (state.format !== "bordeaux-folder/1" || !state.files || typeof state.files !== "object") throw new Error("This folder already contains an unrelated recovery file");
    state.project = prepareProjectFile(state.project);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function openProjectFolder(folder: string): Promise<{ project: BordeauxProject | null; projectPath: string | null; legacyFile?: string }> {
  const stat = await fs.lstat(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Choose a regular project folder");
  const state = await readFolderState(folder);
  if (state) {
    const projectPath = state.projectPath && path.dirname(path.resolve(state.projectPath)) === path.resolve(folder) ? state.projectPath : null;
    const folderName = path.basename(path.resolve(folder));
    if (projectPath) {
      try {
        const [projectStat, recoveryStat] = await Promise.all([fs.lstat(projectPath), fs.lstat(path.join(folder, PROJECT_WORKSPACE_FILE))]);
        if (projectStat.mtimeMs > recoveryStat.mtimeMs) return { project: { ...(await readProject(projectPath)).project, name: folderName }, projectPath };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { project: { ...state.project, name: folderName }, projectPath: projectWorkspacePath(folder) };
  }
  const files = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.bordeaux(?:\.json)?$/i.test(entry.name));
  if (files.length > 1) throw new Error("This folder contains several projects. Open the desired .bordeaux file instead.");
  if (!files.length) return { project: null, projectPath: null };
  const target = path.join(folder, files[0].name);
  const decoded = await readProject(target);
  return { project: { ...decoded.project, name: path.basename(path.resolve(folder)) }, projectPath: saveTargetForOpenedProject(target, decoded), legacyFile: target };
}

/** Whether edits from this legacy project file continue in its folder's workspace. */
export async function workspaceContinuesLegacyFile(filePath: string): Promise<boolean> {
  const file = path.resolve(filePath);
  const state = await readFolderState(path.dirname(file));
  if (!state) return false;
  // Older workspaces journaled recovery for the legacy file they belonged to.
  if (state.projectPath && path.resolve(state.projectPath) === file) return true;
  // Earlier versions recorded an unfinished .bordeaux migration only as its mirror.
  const hashes = [state.importedFrom, state.legacyProjectMirror].flatMap((source) => source && path.resolve(source.file) === file ? [source.hash] : []);
  if (!hashes.length) return false;
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() && !stat.isSymbolicLink() && hashes.includes(digest(await fs.readFile(file)));
  } catch (error) {
    // A migrated .bordeaux file is removed after its workspace is written.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

// Only bytes this process opened, still unchanged, prove the workspace continues a legacy file.
async function importedLegacyFile(folder: string, file: string): Promise<FolderState["importedFrom"]> {
  const source = path.resolve(file);
  const hash = openedProjectHashes.get(source);
  if (!hash || path.dirname(source) !== folder) return undefined;
  try {
    const stat = await fs.lstat(source);
    if (stat.isFile() && !stat.isSymbolicLink() && digest(await fs.readFile(source)) === hash) return { file: source, hash };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return undefined;
}

// A legacy file's contents may replace an existing workspace only when that
// workspace recorded the exact bytes this process opened from it.
function workspaceRecordsOpenedFile(state: FolderState, file: string): boolean {
  const source = path.resolve(file);
  const hash = openedProjectHashes.get(source);
  return hash !== undefined && [state.importedFrom, state.legacyProjectMirror].some((record) => record && path.resolve(record.file) === source && record.hash === hash);
}

function digest(contents: string | Uint8Array): string { return createHash("sha256").update(contents).digest("hex"); }

// Room for the widest duplicate suffix (validation allows 1,024 documents of a
// kind) and the longest extension, so every derived name fits in one component.
const DOCUMENT_STEM_BYTES = MAX_FILE_NAME_BYTES - " (99999)".length - ".routine".length;

function safeDocumentName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().replace(/[. ]+$/, "").slice(0, 120) || "Untitled";
  return portableFileStem(clean, DOCUMENT_STEM_BYTES);
}

async function fileOwnership(folder: string, file: string, stat: { dev: number | bigint; ino: number | bigint }, records: readonly (Record<string, string> | undefined)[]) {
  const hashes = records.flatMap((record) => record?.[file] ? [record[file]] : []);
  const aliases: string[] = [];
  for (const prior of new Set(records.flatMap((record) => Object.keys(record ?? {})))) {
    if (prior === file || prior.toLowerCase() !== file.toLowerCase()) continue;
    try {
      const old = await fs.lstat(path.join(folder, prior));
      const entries = await fs.readdir(path.dirname(path.join(folder, file)));
      // On case-sensitive filesystems, two distinct names (including hard links)
      // are not ownership aliases. On case-insensitive filesystems they are one entry.
      if (!old.isSymbolicLink() && old.dev === stat.dev && old.ino === stat.ino
        && !(entries.includes(path.basename(prior)) && entries.includes(path.basename(file)))) {
        aliases.push(prior);
        hashes.push(...records.flatMap((record) => record?.[prior] ? [record[prior]] : []));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return { hashes, aliases };
}

// Rejects a symlinked or non-directory entry before ownership data is read.
// Saves create it only after every size check, so a rejected save adds no folders.
async function checkRegularDirectory(directory: string, label: string, create = false): Promise<void> {
  if (create) await fs.mkdir(directory, { recursive: true });
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular directory`);
  } catch (error) { if (create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function removeOwnedDocument(folder: string, file: string, hashes: readonly (string | undefined)[], binary = false): Promise<void> {
  if (binary && !/^Paths\/[^/\\]+\.bdx$/i.test(file)) return;
  if (!binary && !/^(Paths\/[^/\\]+\.path|Routines\/[^/\\]+\.routine)$/i.test(file)) return;
  const destination = path.join(folder, file);
  try {
    const directoryStat = await fs.lstat(path.dirname(destination));
    const stat = await fs.lstat(destination);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`${file} is no longer a regular managed file; it was preserved.`);
    if (!hashes.includes(digest(await fs.readFile(destination)))) throw new Error(`${file} changed outside Bordeaux. The old file was preserved.`);
    await fs.unlink(destination);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function legacyProjectMirror(folder: string, old: FolderState | null, openedPath: string | null, openedProject: BordeauxProject): Promise<FolderState["legacyProjectMirror"]> {
  if (old?.legacyProjectMirror) return old.legacyProjectMirror;
  const file = old?.projectPath && /\.bordeaux$/i.test(old.projectPath) ? old.projectPath : openedPath;
  if (!file || path.dirname(path.resolve(file)) !== folder || !/\.bordeaux$/i.test(file)) return undefined;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_FILE_BYTES) return undefined;
    const contents = await fs.readFile(file, "utf8");
    const hash = digest(contents);
    // A first save may contain edits made after opening a standalone project.
    // Original-read provenance proves its old file is still the selected source.
    if (openedProjectHashes.get(path.resolve(file)) === hash) return { file, hash };
    const decoded = decodeProjectFile(contents);
    const expected = old?.project ?? openedProject;
    // Folder naming is canonical even for an imported project called Untitled.
    if (encodeProjectFile({ ...decoded.project, name: path.basename(folder) }).contents
      === encodeProjectFile({ ...expected, name: path.basename(folder) }).contents) return { file, hash: digest(contents) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return undefined;
}

async function removeLegacyProjectMirror(folder: string, mirror: FolderState["legacyProjectMirror"]): Promise<void> {
  if (!mirror || path.dirname(path.resolve(mirror.file)) !== folder || !/\.bordeaux$/i.test(mirror.file)) return;
  try {
    const stat = await fs.lstat(mirror.file);
    if (!stat.isFile() || stat.isSymbolicLink() || digest(await fs.readFile(mirror.file)) !== mirror.hash) throw new Error("The old project file changed outside Bordeaux and was preserved.");
    await fs.unlink(mirror.file);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Save explicitly generated binaries without compiling trajectories during autosave. */
export async function writeProjectFolderBdx(folder: string, files: readonly { fileName: string; bytes: Uint8Array }[]): Promise<void> {
  const target = path.resolve(folder);
  const names = new Set<string>();
  const documents = files.map(({ fileName, bytes }) => {
    const stem = fileName.slice(0, -".bdx".length);
    if (!/^[^<>:"/\\|?*\x00-\x1f]+\.bdx$/i.test(fileName) || portableFileStem(stem, MAX_FILE_NAME_BYTES - ".bdx".length) !== stem) throw new Error("BDX output must have a plain .bdx filename");
    const key = fileName.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate BDX output filename: ${fileName}`);
    names.add(key);
    return { file: `Paths/${fileName}`, bytes: Buffer.from(bytes) };
  });
  const previous = folderQueues.get(target) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const folderStat = await fs.lstat(target);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new Error("Project folder must be a regular directory");
    const state = await readFolderState(target);
    if (!state) throw new Error("Save the project source before generating BDX files");
    const directory = path.join(target, "Paths");
    await checkRegularDirectory(directory, "Paths");
    const observed: Record<string, string> = { ...state.generatedFiles };
    const existing = new Map<string, string>();
    const replacedAliases = new Set<string>();
    for (const document of documents) {
      try {
        const destination = path.join(target, document.file);
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Cannot replace ${document.file}: expected a regular file`);
        const hash = digest(await fs.readFile(destination));
        const ownership = await fileOwnership(target, document.file, stat, [state.generatedFiles, state.pendingGeneratedFiles]);
        if (!ownership.hashes.includes(hash)) throw new Error(`${document.file} is unrelated or changed outside Bordeaux. Preserve or rename it before saving again.`);
        ownership.aliases.forEach((alias) => replacedAliases.add(alias));
        observed[document.file] = hash;
        existing.set(document.file, hash);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const intendedFiles = Object.fromEntries(documents.map((document) => [document.file, digest(document.bytes)]));
    const generatedFiles = intendedFiles;
    const workspace = path.join(target, PROJECT_WORKSPACE_FILE);
    const journal = workspaceContents({ ...state, generatedFiles: observed, pendingGeneratedFiles: { ...state.pendingGeneratedFiles, ...intendedFiles } });
    const committed = workspaceContents({ ...state, generatedFiles, pendingGeneratedFiles: undefined });
    await checkRegularDirectory(directory, "Paths", true);
    // Journal intended hashes first so a failed multi-file save can be retried.
    await replaceFile(workspace, journal);
    for (const document of documents) {
      const destination = path.join(target, document.file);
      if (existing.has(document.file)) {
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink() || digest(await fs.readFile(destination)) !== existing.get(document.file)) throw new Error(`${document.file} changed outside Bordeaux while saving.`);
      }
      await replaceFile(destination, document.bytes, !existing.has(document.file));
      const alias = [...replacedAliases].find((file) => file.toLowerCase() === document.file.toLowerCase());
      if (alias) await fs.rename(path.join(target, alias), destination);
    }
    for (const file of new Set([...Object.keys(state.generatedFiles ?? {}), ...Object.keys(state.pendingGeneratedFiles ?? {})])) {
      if (!(file in generatedFiles) && !replacedAliases.has(file)) await removeOwnedDocument(target, file, [state.generatedFiles?.[file], state.pendingGeneratedFiles?.[file]], true);
    }
    await replaceFile(workspace, committed);
  });
  folderQueues.set(target, pending);
  try { await pending; } finally { if (folderQueues.get(target) === pending) folderQueues.delete(target); }
}

// The workspace is the sole folder project; mirrors follow each committed edit.
// A failed mirror write leaves the latest source recoverable. Only hash-owned
// documents may be replaced or removed after their successors have been written.
// `legacyFile` names the opened project file these edits continue, if any. Its
// edits never replace a workspace that cannot be proven to continue that file.
export async function autosaveProjectFolder(folder: string, value: unknown, projectPath: string | null, options: { createProject?: boolean; legacyFile?: string | null } = {}): Promise<BordeauxProject> {
  const target = path.resolve(folder);
  const decoded = prepareProjectFile(value);
  const project = { ...decoded, name: path.basename(target) };
  const previous = folderQueues.get(target) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const folderStat = await fs.lstat(target);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw new Error("Project folder must be a regular directory");
    if (projectPath && path.dirname(path.resolve(projectPath)) !== target) throw new Error("Project file must stay in the opened folder");
    const old = await readFolderState(target);
    if (old && options.legacyFile && !workspaceRecordsOpenedFile(old, options.legacyFile)) {
      const name = path.basename(options.legacyFile);
      throw new Error(`This folder already has a Bordeaux workspace that may hold newer work than ${name}, so nothing was saved. Open the folder to recover its current work, or use Save As to import ${name} into a different folder.`);
    }
    const workspace = projectWorkspacePath(target);
    if (old && projectPath && path.resolve(projectPath) !== workspace && old.projectPath !== projectPath && old.legacyProjectMirror?.file !== projectPath) {
      try { await fs.lstat(projectPath); throw new Error("This folder is already open for another Bordeaux project"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (options.createProject && projectPath && path.resolve(projectPath) !== workspace) {
      try { await fs.lstat(projectPath); throw Object.assign(new Error("Project file already exists"), { code: "EEXIST" }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const used = new Set<string>();
    const documents = [
      ...project.paths.map((item) => ({ directory: "Paths", extension: "path", item })),
      ...project.routines.map((item) => ({ directory: "Routines", extension: "routine", item })),
    ].map(({ directory, extension, item }) => {
      const stem = `${directory}/${safeDocumentName(item.name)}`;
      const key = `${extension}:${item.id}`;
      const prior = old?.documentFiles?.[key];
      const suffix = prior?.slice(stem.length);
      const reusable = prior?.startsWith(stem) && (suffix === `.${extension}` || suffix?.match(/^ \([1-9][0-9]*\)\.(path|routine)$/)?.[1] === extension);
      const file = prior && reusable && !used.has(prior.toLowerCase()) ? prior : "";
      if (file) used.add(file.toLowerCase());
      return { key, stem, extension, file, contents: `${JSON.stringify(extension === "path" ? { version: "2.0", robot: project.robot, ...item } : { format: "bordeaux-routine/1", ...item }, null, 2)}\n` };
    });
    for (const document of documents) {
      if (document.file) continue;
      let number = 1;
      let file = `${document.stem}.${document.extension}`;
      while (used.has(file.toLowerCase())) file = `${document.stem} (${++number}).${document.extension}`;
      document.file = file; used.add(file.toLowerCase());
    }
    for (const document of documents) withinReadLimit(document.contents, MAX_PROJECT_FILE_BYTES, document.file);
    for (const directory of ["Paths", "Routines"]) await checkRegularDirectory(path.join(target, directory), directory);
    const observedFiles = { ...old?.files };
    const existing = new Map<string, string>();
    const replacedAliases = new Set<string>();
    for (const document of documents) {
      try {
        const destination = path.join(target, document.file);
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_FILE_BYTES) throw new Error(`Cannot replace ${document.file}`);
        const hash = digest(await fs.readFile(destination, "utf8"));
        const ownership = await fileOwnership(target, document.file, stat, [old?.files, old?.pendingFiles]);
        if (!ownership.hashes.includes(hash)) throw new Error(`${document.file} changed outside Bordeaux. Preserve or rename it before saving again.`);
        ownership.aliases.forEach((alias) => replacedAliases.add(alias));
        observedFiles[document.file] = hash; existing.set(document.file, hash);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const files = Object.fromEntries(documents.map((item) => [item.file, digest(item.contents)]));
    const state: FolderState = { format: "bordeaux-folder/1", projectPath: workspace, project, files,
      documentFiles: Object.fromEntries(documents.map((item) => [item.key, item.file])),
      generatedFiles: old?.generatedFiles, pendingGeneratedFiles: old?.pendingGeneratedFiles,
      legacyProjectMirror: await legacyProjectMirror(target, old, projectPath, decoded),
      importedFrom: options.legacyFile ? (await importedLegacyFile(target, options.legacyFile)) ?? old?.importedFrom : old?.importedFrom };
    const journal = workspaceContents({ ...state, files: observedFiles, pendingFiles: { ...old?.pendingFiles, ...files } });
    const committed = workspaceContents({ ...state, legacyProjectMirror: undefined });
    for (const directory of ["Paths", "Routines"]) await checkRegularDirectory(path.join(target, directory), directory, true);
    // Journal the complete source before mirrors; retries recognize both old and
    // partially written new content without deleting anything before replacement.
    await replaceFile(workspace, journal);
    for (const document of documents) {
      const destination = path.join(target, document.file);
      const current = existing.get(document.file);
      if (current) {
        const stat = await fs.lstat(destination);
        if (!stat.isFile() || stat.isSymbolicLink() || digest(await fs.readFile(destination)) !== current) throw new Error(`${document.file} changed outside Bordeaux while saving.`);
      }
      const alias = [...replacedAliases].find((file) => file.toLowerCase() === document.file.toLowerCase());
      // An owned file already holding these bytes needs no replacement unless
      // its entry still carries a case-only alias of the intended name.
      if (current === files[document.file] && !alias) continue;
      await replaceFile(destination, document.contents, !current);
      if (alias) await fs.rename(path.join(target, alias), destination);
    }
    for (const file of new Set([...Object.keys(old?.files ?? {}), ...Object.keys(old?.pendingFiles ?? {})])) {
      if (!(file in files) && !replacedAliases.has(file)) await removeOwnedDocument(target, file, [old?.files[file], old?.pendingFiles?.[file]]);
    }
    await removeLegacyProjectMirror(target, state.legacyProjectMirror);
    await replaceFile(workspace, committed);
    return project;
  });
  folderQueues.set(target, pending);
  try { return await pending; } finally { if (folderQueues.get(target) === pending) folderQueues.delete(target); }
}
