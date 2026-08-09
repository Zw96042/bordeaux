import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBdxExport, previewBdxExport } from "../src/shared/export/bdx";
import { blankPath, buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { decodeProjectValue } from "../src/shared/project/fileFormat";
import { readProject, writeProject } from "../src/electron/projectFiles";
import { validateProject } from "../src/shared/validation";

describe("project files", () => {
  it("creates a valid project with durable editor context", () => {
    const project = createDemoProject();
    expect(validateProject(project)).toEqual({ ok: true, issues: [] });
    expect(project.editor?.activePathId).toBe(project.paths[0].id);
  });

  it("migrates old planner IDs to the maintained planner", () => {
    const project = createDemoProject() as unknown as Record<string, unknown>;
    project.plannerId = "removedPlanner";
    const decoded = decodeProjectValue(project);
    expect(decoded.project.plannerId).toBe("profiledSpline");
    expect(decoded.migrated).toBe(false);
  });

  it("atomically round-trips the selected path and Java bookmark", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-project-test-"));
    const file = path.join(directory, "project.bordeaux.json");
    const project = createDemoProject();
    const second = blankPath("Second");
    project.paths.push(second);
    project.editor = { activePathId: second.id, javaProjectBookmarkId: "a".repeat(20) };
    await writeProject(file, project);
    const opened = await readProject(file);
    expect(opened.project.editor).toEqual(project.editor);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("rejects oversized project files before reading them", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-project-limit-"));
    const file = path.join(directory, "large.bordeaux.json");
    await fs.writeFile(file, Buffer.alloc(16 * 1024 * 1024 + 1));
    await expect(readProject(file)).rejects.toThrow(/16 MiB/);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

describe("native trajectory export", () => {
  it("exports stable path references, routine data, and finite samples", () => {
    const project = createDemoProject();
    const pathId = project.paths[0].id;
    project.routine!.nodes = [{ id: "drive", type: "path", ref: pathId }];
    const exported = buildBdxExport(project);
    expect(exported.schemaVersion).toBe("1.1");
    expect(exported.routine).toEqual(project.routine);
    expect(exported.paths[0].id).toBe(pathId);
    expect(exported.paths[0].samples.length).toBeGreaterThan(1);
    expect(exported.paths[0].samples.every((sample) => Object.values(sample).every(Number.isFinite))).toBe(true);
  });

  it("retains anchored marker timing after path length changes", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{ id: "fixed", f: 0.5, anchor: "dist", d: 2, name: "fixed" }];
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 11, y: 2 }]);
    expect(buildBdxExport(project).paths[0].markers[0].fraction).toBeCloseTo(0.2, 2);
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 15, y: 2 }]);
    expect(buildBdxExport(project).paths[0].markers[0].fraction).toBeCloseTo(2 / 14, 2);
  });

  it("blocks measured planner errors", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = project.paths[0].waypoints.slice(0, 1);
    expect(previewBdxExport(project).ok).toBe(false);
    expect(() => buildBdxExport(project)).toThrow();
  });
});
