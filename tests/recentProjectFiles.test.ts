import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRecentProjectFiles, rememberRecentProject, writeRecentProjectFiles } from "../src/electron/recentProjectFiles";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("recent project files", () => {
  it("persists absolute paths in most-recent order", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-projects-"));
    directories.push(directory);
    const filePath = path.join(directory, "recent-projects.json");
    const first = path.join(directory, "first.bordeaux.json");
    const second = path.join(directory, "second.bordeaux.json");
    let projects = rememberRecentProject([], first);
    projects = rememberRecentProject(projects, second);
    projects = rememberRecentProject(projects, first);

    await writeRecentProjectFiles(filePath, projects);

    expect(await readRecentProjectFiles(filePath)).toEqual([first, second]);
  });

  it("drops malformed entries and rejects oversized storage", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-projects-"));
    directories.push(directory);
    const filePath = path.join(directory, "recent-projects.json");
    await fs.writeFile(filePath, JSON.stringify({ version: 1, projects: ["relative.json"] }));
    expect(await readRecentProjectFiles(filePath)).toEqual([]);
    await fs.writeFile(filePath, " ".repeat(64 * 1024 + 1));
    await expect(readRecentProjectFiles(filePath)).rejects.toThrow(/size limit/);
  });
});
