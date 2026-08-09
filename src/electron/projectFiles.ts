import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BordeauxProject } from "../shared/types";
import { decodeProjectFile, encodeProjectFile } from "../shared/project/fileFormat";
import type { DecodedProjectFile } from "../shared/project/fileFormat";

const writeQueues = new Map<string, Promise<void>>();
const MAX_PROJECT_FILE_BYTES = 16 * 1024 * 1024;

export function parseProject(contents: string): BordeauxProject {
  return decodeProjectFile(contents).project;
}

export async function readProject(filePath: string): Promise<DecodedProjectFile> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Bordeaux project must be a regular file");
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw new Error("Bordeaux project exceeds the 16 MiB size limit");
  return decodeProjectFile(await fs.readFile(filePath, "utf8"));
}

export function saveTargetForOpenedProject(filePath: string, decoded: DecodedProjectFile): string | null {
  return decoded.migrated ? null : filePath;
}

async function replaceFile(filePath: string, contents: string | Uint8Array): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, contents, typeof contents === "string" ? { encoding: "utf8", flag: "wx" } : { flag: "wx" });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeProject(filePath: string, value: unknown): Promise<BordeauxProject> {
  const { project, contents } = encodeProjectFile(value);
  const target = path.resolve(filePath);
  const previous = writeQueues.get(target) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => replaceFile(target, contents));
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
