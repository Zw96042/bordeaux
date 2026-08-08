import fs from "node:fs/promises";
import path from "node:path";
import { writeJsonAtomically } from "./projectFiles";

const VERSION = 1;
const MAX_PROJECTS = 8;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_PATH_LENGTH = 4_096;

function normalizeProjects(values: unknown[]): string[] {
  const projects: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length > MAX_PATH_LENGTH || !path.isAbsolute(value)) continue;
    const projectPath = path.normalize(value);
    if (!projects.includes(projectPath)) projects.push(projectPath);
    if (projects.length === MAX_PROJECTS) break;
  }
  return projects;
}

export async function readRecentProjectFiles(filePath: string): Promise<string[]> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isFile()) throw new Error("Recent project storage is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("Recent project storage exceeds its size limit");
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Recent project storage is invalid");
  const stored = parsed as { version?: unknown; projects?: unknown };
  if (stored.version !== VERSION || !Array.isArray(stored.projects)) throw new Error("Recent project storage version is unsupported");
  return normalizeProjects(stored.projects);
}

export async function writeRecentProjectFiles(filePath: string, projects: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomically(filePath, { version: VERSION, projects: normalizeProjects(projects) });
}

export function rememberRecentProject(projects: string[], projectPath: string): string[] {
  const normalizedPath = path.normalize(projectPath);
  return [normalizedPath, ...projects.filter((item) => path.normalize(item) !== normalizedPath)].slice(0, MAX_PROJECTS);
}
