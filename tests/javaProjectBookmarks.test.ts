import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readJavaProjectBookmarks,
  rememberJavaProject,
  summarizeJavaProjectBookmarks,
  writeJavaProjectBookmarks,
} from "../src/electron/javaProjectBookmarks";

const temporaryDirectories: string[] = [];

async function temporaryFile(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-bookmarks-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "java-projects.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Java project bookmarks", () => {
  it("persists bounded project records while renderer summaries omit paths", async () => {
    const filePath = await temporaryFile();
    let bookmarks = rememberJavaProject([], "/tmp/robot-one", "Robot One", new Date("2026-08-04T12:00:00Z"));
    bookmarks = rememberJavaProject(bookmarks, "/tmp/robot-two", "Robot Two", new Date("2026-08-04T13:00:00Z"));
    bookmarks = rememberJavaProject(bookmarks, "/tmp/robot-one", "Robot One Renamed", new Date("2026-08-04T14:00:00Z"));

    await writeJavaProjectBookmarks(filePath, bookmarks);
    const restored = await readJavaProjectBookmarks(filePath);
    const summaries = summarizeJavaProjectBookmarks(restored);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({ projectName: "Robot One Renamed", projectPath: "/tmp/robot-one" });
    expect(summaries[0]).toEqual({
      id: restored[0].id,
      projectName: "Robot One Renamed",
      folderName: "robot-one",
      lastLinkedAt: "2026-08-04T14:00:00.000Z",
    });
    expect(summaries[0]).not.toHaveProperty("projectPath");
  });

  it("rejects oversized storage and drops malformed bookmark entries", async () => {
    const filePath = await temporaryFile();
    await fs.writeFile(filePath, JSON.stringify({
      version: 1,
      projects: [
        { projectName: "Bad", folderName: "bad", lastLinkedAt: "not-a-date", projectPath: "relative/path" },
      ],
    }));
    expect(await readJavaProjectBookmarks(filePath)).toEqual([]);

    await fs.writeFile(filePath, " ".repeat(64 * 1024 + 1));
    await expect(readJavaProjectBookmarks(filePath)).rejects.toThrow(/size limit/);
  });
});
