import fs from "node:fs/promises";
import path from "node:path";
import { createDemoProject } from "../shared/project/defaults";
import type { BordeauxProject } from "../shared/types";
import { openProjectFolder, readProject, saveTargetForOpenedProject } from "./projectFiles";

export interface ProjectSelection {
  project: BordeauxProject;
  projectPath: string | null;
  folderPath: string;
  recentPath: string;
}

async function hasRecovery(folder: string): Promise<boolean> {
  try { await fs.lstat(path.join(folder, ".bordeaux-workspace.json")); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function loadProjectFolderSelection(folder: string): Promise<ProjectSelection> {
  const opened = await openProjectFolder(folder);
  return { project: opened.project ?? { ...createDemoProject(), name: path.basename(folder) },
    projectPath: opened.projectPath, folderPath: folder, recentPath: folder };
}

// Loading never changes the active target, dirty state, recent list, or robot link.
// The caller commits a selection only after every read and parse has succeeded.
export async function loadProjectSelection(filePath: string): Promise<ProjectSelection> {
  if ((await fs.lstat(filePath)).isDirectory()) return loadProjectFolderSelection(filePath);
  if (/\.(path|routine)$/i.test(filePath) && ["Paths", "Routines"].includes(path.basename(path.dirname(filePath)))) {
    const folder = path.dirname(path.dirname(filePath));
    if (await hasRecovery(folder)) {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("Managed project document must be a regular file under 16 MiB");
      const item: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") throw new Error("Managed project document must have an item ID");
      const selection = await loadProjectFolderSelection(folder);
      if (selection.project.paths.some((entry) => entry.id === item.id)) selection.project.editor = { ...selection.project.editor, activePathId: item.id };
      if (selection.project.routines.some((entry) => entry.id === item.id)) selection.project.activeRoutineId = item.id;
      return selection;
    }
  }
  const decoded = await readProject(filePath);
  let { project } = decoded;
  const folder = path.dirname(filePath);
  if (await hasRecovery(folder)) {
    const recovered = await openProjectFolder(folder);
    if (recovered.project && recovered.projectPath && path.resolve(recovered.projectPath) === path.resolve(filePath)) project = recovered.project;
  }
  return { project, projectPath: saveTargetForOpenedProject(filePath, decoded), folderPath: folder, recentPath: filePath };
}
