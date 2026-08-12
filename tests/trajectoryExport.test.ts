import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBdxExport } from "../src/shared/export/bdx";
import { getPlanner } from "../src/shared/planners";
import { blankPath, buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { decodeProjectValue, encodeProjectFile } from "../src/shared/project/fileFormat";
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
    expect(decoded.migrated).toBe(true);
  });

  it("migrates schema 1.0 zero angular deceleration to the legacy fallback", () => {
    const source = createDemoProject();
    source.paths[0].constraints.maxAngAccel = 90;
    source.paths[0].constraints.maxAngDecel = 0;
    source.paths[0].waypoints.at(-1)!.stop = true;
    source.paths[0].waypoints.at(-1)!.turnInPlace = { headingDeg: 45, direction: "shortest" };

    const decoded = decodeProjectValue(source);

    expect(decoded.migrated).toBe(true);
    expect(decoded.project.paths[0].constraints.maxAngDecel).toBe(90);
    expect(validateProject(decoded.project)).toEqual({ ok: true, issues: [] });
    for (const plannerId of ["profiledSpline", "optimizedTrajectory"] as const) {
      decoded.project.plannerId = plannerId;
      expect(() => getPlanner(plannerId).generate({ path: decoded.project.paths[0], robot: decoded.project.robot }))
        .not.toThrow();
      expect(() => buildBdxExport(decoded.project)).not.toThrow();
    }
  });

  it("imports singular routines but keeps canonical project files singular-free", () => {
    const source = createDemoProject() as unknown as Record<string, unknown>;
    delete source.routines;
    delete source.activeRoutineId;
    source.routine = { name: "Legacy routine", nodes: [{ id: "drive", type: "path", ref: 0 }] };
    (source.paths as Array<Record<string, unknown>>)[0].labview = { stale: true };

    const decoded = decodeProjectValue(source);
    const encoded = encodeProjectFile(decoded.project);

    expect(decoded.migrated).toBe(true);
    expect(decoded.project.routines[0]).toMatchObject({ name: "Legacy routine", nodes: [{ ref: decoded.project.paths[0].id }] });
    expect(decoded.project.activeRoutineId).toBe(decoded.project.routines[0].id);
    expect(decoded.project.paths[0]).not.toHaveProperty("labview");
    expect(decoded.project).not.toHaveProperty("routine");
    expect(JSON.parse(encoded.contents)).not.toHaveProperty("routine");
  });

  it("rejects incomplete canonical state before it reaches a planner", () => {
    const project = createDemoProject() as unknown as Record<string, unknown>;
    delete project.plannerId;
    delete project.pathLinks;

    expect(validateProject(project).issues.map((item) => item.path)).toEqual(expect.arrayContaining([
      "$.plannerId",
      "$.pathLinks",
    ]));
    expect(() => buildBdxExport(project as unknown as ReturnType<typeof createDemoProject>)).toThrow(/Planner/);
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
    const selectedRoutine = {
      id: "routine_selected",
      name: "Selected routine",
      nodes: [{ id: "drive", type: "path" as const, ref: pathId }],
    };
    project.routines.push(selectedRoutine);
    project.activeRoutineId = selectedRoutine.id;
    const exported = buildBdxExport(project);
    expect(exported.schemaVersion).toBe("1.1");
    expect(exported.routine).toEqual(selectedRoutine);
    expect(exported.paths[0].id).toBe(pathId);
    expect(exported.paths[0].samples.length).toBeGreaterThan(1);
    expect(exported.paths[0]).not.toHaveProperty("waypointSampleIndices");
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
    expect(() => buildBdxExport(project)).toThrow();
  });
});
