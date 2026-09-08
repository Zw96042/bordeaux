import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { availableRobotProjectRuntimes, discoverRobotProject } from "../src/electron/robotProjectRuntime";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });
describe("LabVIEW project discovery", () => {
  it("discovers LabVIEW XML without executing a project build or VI", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-lv-project-")));
    directories.push(root);
    await fs.writeFile(path.join(root, "Robot.lvproj"), "<Project/>");
    await expect(availableRobotProjectRuntimes(root)).resolves.toEqual(["labview"]);
    await expect(discoverRobotProject(root)).resolves.toMatchObject({ runtime: "labview", commands: [] });
  });
  it("does not treat arbitrary folders as robot projects", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-empty-project-")));
    directories.push(root);
    await expect(availableRobotProjectRuntimes(root)).resolves.toEqual([]);
    await expect(discoverRobotProject(root)).rejects.toThrow(/LabVIEW/);
  });
});
