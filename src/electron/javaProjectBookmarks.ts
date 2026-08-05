import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { JavaProjectBookmarkSummary } from "../shared/types";
import { writeJsonAtomically } from "./projectFiles";

const BOOKMARK_VERSION = 1;
const MAX_BOOKMARKS = 8;
const MAX_BOOKMARK_FILE_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 256;
const MAX_PATH_LENGTH = 4_096;

export interface JavaProjectBookmark extends JavaProjectBookmarkSummary {
  projectPath: string;
}

interface StoredJavaProjectBookmarks {
  version: typeof BOOKMARK_VERSION;
  projects: JavaProjectBookmark[];
}

function bookmarkId(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 20);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function normalizeBookmark(value: unknown): JavaProjectBookmark | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!validText(candidate.projectName) || !validText(candidate.folderName) || !validText(candidate.lastLinkedAt)) return null;
  if (typeof candidate.projectPath !== "string" || candidate.projectPath.length > MAX_PATH_LENGTH || !path.isAbsolute(candidate.projectPath)) return null;
  const projectPath = path.normalize(candidate.projectPath);
  const parsedDate = Date.parse(candidate.lastLinkedAt);
  if (!Number.isFinite(parsedDate)) return null;
  return {
    id: bookmarkId(projectPath),
    projectName: candidate.projectName,
    folderName: candidate.folderName,
    lastLinkedAt: new Date(parsedDate).toISOString(),
    projectPath,
  };
}

function normalizeBookmarks(values: unknown[]): JavaProjectBookmark[] {
  const bookmarks: JavaProjectBookmark[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const bookmark = normalizeBookmark(value);
    if (!bookmark || ids.has(bookmark.id)) continue;
    bookmarks.push(bookmark);
    ids.add(bookmark.id);
    if (bookmarks.length === MAX_BOOKMARKS) break;
  }
  return bookmarks;
}

export async function readJavaProjectBookmarks(filePath: string): Promise<JavaProjectBookmark[]> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!stat.isFile()) throw new Error("Java project bookmark storage is not a file");
  if (stat.size > MAX_BOOKMARK_FILE_BYTES) throw new Error("Java project bookmark storage exceeds its size limit");
  const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Java project bookmark storage is invalid");
  const stored = parsed as Partial<StoredJavaProjectBookmarks>;
  if (stored.version !== BOOKMARK_VERSION || !Array.isArray(stored.projects)) throw new Error("Java project bookmark storage version is unsupported");
  return normalizeBookmarks(stored.projects);
}

export async function writeJavaProjectBookmarks(filePath: string, bookmarks: JavaProjectBookmark[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const projects = normalizeBookmarks(bookmarks);
  await writeJsonAtomically(filePath, { version: BOOKMARK_VERSION, projects } satisfies StoredJavaProjectBookmarks);
}

export function rememberJavaProject(
  bookmarks: JavaProjectBookmark[],
  projectPath: string,
  projectName: string,
  linkedAt = new Date(),
): JavaProjectBookmark[] {
  const normalizedPath = path.normalize(projectPath);
  const bookmark: JavaProjectBookmark = {
