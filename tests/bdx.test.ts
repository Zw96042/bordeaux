import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBdxExport, previewBdxExport } from "../src/shared/export/bdx";
import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import { clampWorldPoint, FIELD_H, FIELD_W } from "../src/shared/math/fieldBounds";
import { PM } from "../src/shared/math/pm";
import { blankPath, buildWaypoints, clone, createDemoProject } from "../src/shared/project/defaults";
import type { BordeauxProject, PathDoc } from "../src/shared/types";
import { validateProject } from "../src/shared/validation";
import { parseProject, readProject, saveTargetForOpenedProject, writeBufferAtomically, writeProject } from "../src/electron/projectFiles";

class BinaryReader {
  offset = 0;

  constructor(readonly buffer: Buffer) {}

  string(): string {
    const length = this.u32();
    const value = this.buffer.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  boolean(): boolean { return this.buffer.readUInt8(this.offset++) !== 0; }
  u16(): number { const value = this.buffer.readUInt16BE(this.offset); this.offset += 2; return value; }
  i32(): number { const value = this.buffer.readInt32BE(this.offset); this.offset += 4; return value; }
  u32(): number { const value = this.buffer.readUInt32BE(this.offset); this.offset += 4; return value; }
  f64(): number { const value = this.buffer.readDoubleBE(this.offset); this.offset += 8; return value; }
  skip(bytes: number): void { this.offset += bytes; }
}

function readEndpointVelocities(buffer: Buffer): { first: number; last: number; initial: number; final: number } {
  const reader = new BinaryReader(buffer);
  reader.string(); reader.boolean(); reader.boolean(); reader.u32(); reader.string(); reader.u16();
  const positionCount = reader.u32();
  reader.skip(positionCount * 3 * 8);
  const velocityCount = reader.u32();
  let first = 0;
  let last = 0;
  for (let index = 0; index < velocityCount; index += 1) {
    const velocity = reader.f64();
    if (index === 0) first = velocity;
    if (index === velocityCount - 1) last = velocity;
    reader.skip(3 * 8);
  }
  reader.i32(); reader.i32();
  if (reader.u32() !== 0) throw new Error("Test reader does not support commands");
  reader.f64();
  reader.skip(4 * 8);
  return { first, last, initial: reader.f64(), final: reader.f64() };
}

function projectWithPaths(paths: PathDoc[]): BordeauxProject {
  return {
    schemaVersion: "1.0",
    name: "TestProject",
    robot: { drive: "swerve", w: 0.84, l: 0.84, maxSpeed: 5.0 },
    paths,
    routine: { name: "Autonomous Routine", nodes: [] },
  };
}

function richPath(name = "RichPath"): PathDoc {
  const path = blankPath(name);
  path.waypoints = buildWaypoints([
    { x: 2.2, y: 4.0, theta: 0, segType: "clothoid" },
    { x: 3.2, y: 4.7, stop: true, segType: "bezier" },
    { x: 5.4, y: 4.0, theta: 0 },
  ]);
  path.markers = [{ f: 0.66, name: "score_L4", cmd: "scoreL4", group: "sequential" }];
  path.ranges = [
    {
      anchor: "param",
      f0: 0.35,
      f1: 0.8,
      maxVel: 1.5,
      maxAccel: 2.4,
      maxDecel: 2,
      maxAngVel: 220,
      maxAngAccel: 400,
      name: "Approach",
    },
  ];
  return path;
}

describe("project defaults and validation", () => {
  it("starts with one blank path and no routine preset", () => {
    const project = createDemoProject();
    expect(project.name).toBe("Untitled");
    expect(project.paths.map((p) => p.name)).toEqual(["NewPath"]);
    expect(project.routine?.nodes).toEqual([]);
    expect(validateProject(project).ok).toBe(true);
  });

  it("rejects paths with fewer than two waypoints", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = [project.paths[0].waypoints[0]];
    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.message.includes("at least two waypoints"))).toBe(true);
  });

  it.each([
    { paths: "bad" },
    { paths: [null] },
    { paths: [{ waypoints: "bad" }] },
    { paths: [{ waypoints: [null] }] },
  ])("never throws for malformed project containers", (value) => {
    expect(() => validateProject(value)).not.toThrow();
    expect(validateProject(value).ok).toBe(false);
  });

  it("rejects malformed nested planner values", () => {
    const project = createDemoProject() as unknown as Record<string, any>;
    project.paths[0].waypoints[0].nextC.x = "not-a-number";
    project.paths[0].markers = [{ f: Number.NaN, name: "bad" }];
    project.paths[0].ranges = [{ anchor: "unknown" }];
    project.plannerId = "unknown";
    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((item) => item.path)).toEqual(expect.arrayContaining([
      "$.paths[0].waypoints[0].nextC.x",
      "$.paths[0].markers[0].f",
      "$.paths[0].ranges[0].anchor",
      "$.plannerId",
    ]));
    expect(() => buildBdxExport(project as BordeauxProject)).toThrow(/Invalid Bordeaux project|finite/);
  });

  it("round-trips path folders and per-segment modes", () => {
    const project = createDemoProject();
    project.pathFolders = [{ id: "folder_scoring", name: "Scoring" }];
    project.paths[0].folderId = "folder_scoring";
    project.paths[0].waypoints[0].segmentHeadingMode = "tangent";
    project.paths[0].followMode = "position";
    project.paths[0].waypoints[0].segmentFollowMode = "time";

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.pathFolders).toEqual(project.pathFolders);
    expect(parsed.paths[0].folderId).toBe("folder_scoring");
    expect(parsed.paths[0].waypoints[0].segmentHeadingMode).toBe("tangent");
    expect(parsed.paths[0].followMode).toBe("position");
    expect(parsed.paths[0].waypoints[0].segmentFollowMode).toBe("time");
  });

  it("round-trips conditional position event schedules", () => {
    const project = createDemoProject();
    project.paths[0].markers = [{
      id: "event_intake", f: 0.4, name: "Intake", schedule: {
        trigger: "position", repeatEveryS: 0.1, endTimeS: 2.5, conditionId: "frc.robot.Conditions#hasNote",
      },
    }];
    expect(parseProject(JSON.stringify(project)).paths[0].markers[0].schedule).toEqual(project.paths[0].markers[0].schedule);

    (project.paths[0].markers[0].schedule as any).trigger = "distance";
    expect(validateProject(project).issues.some((issue) => issue.path.endsWith("schedule.trigger"))).toBe(true);
  });

  it("rejects orphan folders and invalid per-segment heading modes", () => {
    const project = createDemoProject() as unknown as Record<string, any>;
    project.pathFolders = [{ id: "folder_one", name: "One" }];
    project.paths[0].folderId = "folder_missing";
    project.paths[0].waypoints[0].segmentHeadingMode = "locked";
    project.paths[0].followMode = "distance";
    project.paths[0].waypoints[0].segmentFollowMode = "automatic";

    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((item) => item.path)).toEqual(expect.arrayContaining([
      "$.paths[0].folderId",
      "$.paths[0].waypoints[0].segmentHeadingMode",
      "$.paths[0].followMode",
      "$.paths[0].waypoints[0].segmentFollowMode",
    ]));
  });

  it("clamps world points to the true field dimensions", () => {
    expect(clampWorldPoint({ x: -3, y: FIELD_H + 2 })).toEqual({ x: 0, y: FIELD_H });
    expect(clampWorldPoint({ x: FIELD_W + 1, y: -1 })).toEqual({ x: FIELD_W, y: 0 });
  });
});

describe(".bdx export", () => {
  it("exports the blank default project", () => {
    const exportData = buildBdxExport(createDemoProject());
    expect(exportData.paths).toHaveLength(1);
    expect(exportData.paths[0].name).toBe("NewPath");
    expect(exportData.paths[0].samples.length).toBeGreaterThan(2);
    expect(exportData.robot).toMatchObject({ widthM: 0.84, lengthM: 0.84, heightM: 0.5 });
  });

  it("exports eligible paths in project order", () => {
    const project = projectWithPaths([blankPath("First"), richPath("Second"), blankPath("Third")]);
    const exportData = buildBdxExport(project);
    expect(exportData.paths.map((path) => path.name)).toEqual(["First", "Second", "Third"]);
    expect(exportData.generator).toBe("bordeaux");
    expect(exportData.units.velocity).toBe("meters_per_second");
  });

  it("includes full sampled trajectory fields", () => {
    const sample = buildBdxExport(projectWithPaths([richPath()])).paths[0].samples[0];
    expect(sample).toEqual(
      expect.objectContaining({
        i: expect.any(Number),
        t: expect.any(Number),
        s: expect.any(Number),
        f: expect.any(Number),
        x: expect.any(Number),
        y: expect.any(Number),
        headingRad: expect.any(Number),
        velocityMps: expect.any(Number),
        accelerationMps2: expect.any(Number),
        angularVelocityRadps: expect.any(Number),
        curvatureInvM: expect.any(Number),
      }),
    );
  });

  it("forces stop waypoint velocity to zero", () => {
    const path = richPath("StopPath");
    const exportData = buildBdxExport(projectWithPaths([path]));
    const stopIndex = Math.round((path.waypoints.length - 2) / Math.max(1, path.waypoints.length - 1) * (exportData.paths[0].samples.length - 1));
    expect(exportData.paths[0].samples[stopIndex].velocityMps).toBeCloseTo(0, 4);
  });

  it("resolves markers to exported timestamps and fractions", () => {
    const marker = buildBdxExport(projectWithPaths([richPath()])).paths[0].markers[0];
    expect(marker.name).toBe("score_L4");
    expect(marker.command).toBe("scoreL4");
    expect(marker.fraction).toBeCloseTo(0.66, 5);
    expect(marker.timeS).toBeGreaterThan(0);
  });

  it("omits non-exportable routine preview paths", () => {
    const hidden = clone(richPath("runtime_preview"));
    hidden.exportable = false;
    const exportData = buildBdxExport(projectWithPaths([blankPath("Real"), hidden]));
    expect(exportData.paths.map((path) => path.name)).toEqual(["Real"]);
  });

  it("provides an export preview summary", () => {
    const preview = previewBdxExport(createDemoProject());
    expect(preview.ok).toBe(true);
    expect(preview.pathCount).toBe(1);
    expect(preview.sampleCount).toBeGreaterThan(2);
    expect(preview.totalTimeS).toBeGreaterThan(0);
  });

  it("exports optimized trajectory samples with planner diagnostics", () => {
    const project = projectWithPaths([richPath("Optimized")]);
    project.plannerId = "optimizedTrajectory";
    const exportData = buildBdxExport(project);
    expect(exportData.paths[0].planner).toBe("optimizedTrajectory");
    expect(exportData.paths[0].samples.length).toBeGreaterThan(2);
    expect(exportData.paths[0].optimization).toEqual(
      expect.objectContaining({
        plannerUsed: "optimizedTrajectory",
        fallback: false,
        solveTimeMs: expect.any(Number),
        maxVelocityMps: expect.any(Number),
      }),
    );
  });

  it("blocks trajectories with error diagnostics in preview and direct export", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1, theta: 0, segType: "bezier" },
      { x: 1.05, y: 7, theta: 0, segType: "bezier" },
      { x: 1.1, y: 1, theta: 0 },
    ]);
    expect(previewBdxExport(project).ok).toBe(false);
    expect(() => buildBdxExport(project)).toThrow(/radius|curvature|turn/i);
  });

  it("interpolates optimized marker timestamps from the final retimed samples", () => {
    const project = createDemoProject();
    project.plannerId = "optimizedTrajectory";
    project.paths[0].waypoints = buildWaypoints([
      { x: 2.2, y: 4, theta: 0, segType: "bezier" },
      { x: 3.2, y: 4, stop: true, segType: "bezier" },
      { x: 5.4, y: 4, theta: 0 },
    ]);
    project.paths[0].markers = [{ f: 0.66, name: "m" }];
    const path = buildBdxExport(project).paths[0];
    const index = path.samples.findIndex((sample) => sample.f >= 0.66);
    const previous = path.samples[index - 1];
    const current = path.samples[index];
    const expected = previous.t + ((0.66 - previous.f) / (current.f - previous.f)) * (current.t - previous.t);
    expect(path.markers[0].timeS).toBeCloseTo(expected, 4);
  });

  it("keeps distance-locked marker travel fixed when the path is extended", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 11, y: 2 }]);
    project.paths[0].markers = [{ f: 0.5, anchor: "dist", d: 2, name: "fixed" }];
    expect(buildBdxExport(project).paths[0].markers[0].fraction).toBeCloseTo(0.2, 2);
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 15, y: 2 }]);
    expect(buildBdxExport(project).paths[0].markers[0].fraction).toBeCloseTo(2 / 14, 2);
  });

  it("exports the authored routine with stable path references", () => {
    const project = createDemoProject();
    project.routine!.nodes = [{ id: "routine_path", type: "path", ref: project.paths[0].id }];
    const exported = buildBdxExport(project);
    expect(exported.schemaVersion).toBe("1.1");
    expect(exported.routine).toEqual(project.routine);
    expect((exported.routine!.nodes[0] as { ref: string }).ref).toBe(project.paths[0].id);
    expect(exported.paths.filter((path) => path.id === (exported.routine!.nodes[0] as { ref: string }).ref)).toHaveLength(1);
  });
});

describe("LabVIEW .bdx compatibility", () => {
  it("writes Bordeaux 4.4 fields in LabVIEW big-endian binary order", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 2, y: 2 }]);
    const result = buildLabviewBdx(project, project.paths[0].id);
    const reader = new BinaryReader(result.buffer);

    expect(result.buffer[0]).toBe(0);
    expect(result.buffer.toString("utf8", 4, 7)).toBe("4.4");
    expect(reader.string()).toBe("4.4");
    expect(reader.boolean()).toBe(false); // Robot Backwards
    expect(reader.boolean()).toBe(false); // Reverse Path
    expect(reader.u32()).toBe(1); // one trajectory segment
    expect(reader.string()).toBe("Bezier");
    expect(reader.u16()).toBe(4);

    const positionCount = reader.u32();
    expect(positionCount).toBe(result.sampleCount);
    expect(reader.f64()).toBeCloseTo(3.280839895, 8);
    expect(reader.f64()).toBeCloseTo(6.56167979, 8);
    expect(reader.f64()).toBeCloseTo(0, 8);
    reader.skip((positionCount - 1) * 3 * 8);

    const velocityCount = reader.u32();
    expect(velocityCount).toBe(positionCount);
    reader.skip(velocityCount * 4 * 8);
    expect(reader.i32()).toBeGreaterThanOrEqual(0);
    expect(reader.i32()).toBeLessThan(positionCount);
    expect(reader.u32()).toBe(0); // commands
    expect(reader.f64()).toBe(0.02);
    expect(reader.f64()).toBeCloseTo(project.paths[0].constraints.maxVel * 3.280839895, 8);
    reader.skip(5 * 8); // remaining translational limits and conditions
    expect(reader.u32()).toBe(0); // overrides
    reader.skip(3 * 8); // angular limits
    expect(reader.u32()).toBe(2);
    reader.skip(2 * 3 * 8);
    expect(reader.f64()).toBeCloseTo((positionCount - 1) * 0.02, 10);
    expect(reader.f64()).toBeCloseTo(3.280839895, 6);
    expect(reader.boolean()).toBe(false);
    expect(reader.u16()).toBe(1); // Holonomic
    expect(reader.u16()).toBe(1); // Bezier
    expect(reader.boolean()).toBe(false);
    expect(reader.f64()).toBe(0);
    expect(reader.boolean()).toBe(false);
    expect(reader.boolean()).toBe(false);
    expect(reader.offset).toBe(result.buffer.length);
  });

  it("exports only the selected path", () => {
    const first = blankPath("First");
    const second = blankPath("Second");
    second.waypoints = buildWaypoints([{ x: 7, y: 1 }, { x: 8, y: 1 }]);
    const project = projectWithPaths([first, second]);
    const result = buildLabviewBdx(project, second.id);
    const reader = new BinaryReader(result.buffer);
    reader.string(); reader.boolean(); reader.boolean(); reader.u32(); reader.string(); reader.u16(); reader.u32();
    expect(result.pathName).toBe("Second");
    expect(reader.f64()).toBeCloseTo(7 * 3.280839895, 8);
  });

  it("does not let an unrelated invalid path block the selected path", () => {
    const selected = blankPath("Selected");
    const invalid = blankPath("Invalid");
    invalid.waypoints = invalid.waypoints.slice(0, 1);
    const project = projectWithPaths([selected, invalid]);
    expect(buildLabviewBdx(project, selected.id).pathName).toBe("Selected");
  });

  it("time-scales samples onto exact 20 ms ticks without moving the endpoint", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([{ x: 1, y: 2 }, { x: 2, y: 2 }]);
    project.paths[0].startVel = 0.4;
    project.paths[0].goalVel = 0.6;
    const planned = buildBdxExport(project).paths[0];
    const result = buildLabviewBdx(project, project.paths[0].id);
    const durationS = (result.sampleCount - 1) * result.samplePeriodS;
    const timeScale = planned.totalTimeS / durationS;
    const reader = new BinaryReader(result.buffer);
    reader.string(); reader.boolean(); reader.boolean(); reader.u32(); reader.string(); reader.u16();
    const positionCount = reader.u32();
    reader.skip((positionCount - 1) * 3 * 8);
    expect(reader.f64()).toBeCloseTo(2 * 3.280839895, 8);
    expect(reader.f64()).toBeCloseTo(2 * 3.280839895, 8);
    reader.f64();
    const velocityCount = reader.u32();
    expect(velocityCount).toBe(positionCount);
    expect(reader.f64()).toBeCloseTo(project.paths[0].startVel * timeScale * 3.280839895, 6);
    reader.skip((velocityCount - 2) * 4 * 8 + 3 * 8);
    expect(reader.f64()).toBeCloseTo(project.paths[0].goalVel * timeScale * 3.280839895, 6);
    reader.skip(3 * 8); // remaining final velocity-vector fields
    reader.i32(); reader.i32();
    expect(reader.u32()).toBe(0); // commands
    expect(reader.f64()).toBe(result.samplePeriodS);
    reader.skip(4 * 8); // translational limits
    expect(reader.f64()).toBeCloseTo(project.paths[0].startVel * 3.280839895, 6);
    expect(reader.f64()).toBeCloseTo(project.paths[0].goalVel * 3.280839895, 6);
    expect(durationS).toBeGreaterThanOrEqual(planned.totalTimeS);
    expect(durationS - planned.totalTimeS).toBeLessThan(result.samplePeriodS);
  });

  it("writes authored endpoint conditions clamped to semantic limits", () => {
    const project = createDemoProject();
    project.paths[0].startVel = project.paths[0].constraints.maxVel * 2;
    project.paths[0].goalVel = 1;
    project.paths[0].waypoints[project.paths[0].waypoints.length - 1].stop = true;
    const velocities = readEndpointVelocities(buildLabviewBdx(project, project.paths[0].id).buffer);
    expect(velocities.initial).toBeCloseTo(project.paths[0].constraints.maxVel * 3.280839895, 9);
    expect(velocities.final).toBe(0);
  });

  it("labels only homogeneous LabVIEW path types", () => {
    const clothoid = createDemoProject();
    clothoid.paths[0].waypoints.slice(0, -1).forEach((waypoint) => { waypoint.segType = "clothoid"; });
    const result = buildLabviewBdx(clothoid, clothoid.paths[0].id);
    const reader = new BinaryReader(result.buffer);
    reader.string(); reader.boolean(); reader.boolean(); reader.u32();
    expect(reader.string()).toBe("Linear 0");
    expect(reader.u16()).toBe(0);

    const mixed = createDemoProject();
    mixed.paths[0].waypoints[0].segType = "line";
    expect(() => buildLabviewBdx(mixed, mixed.paths[0].id)).toThrow(/entirely Bezier or entirely clothoid/);
  });

  it("rejects position-followed segments in LabVIEW exports", () => {
    const project = createDemoProject();
    project.paths[0].followMode = "position";
    expect(() => buildLabviewBdx(project, project.paths[0].id)).toThrow(/cannot encode position-based following/);

    project.paths[0].waypoints[0].segmentFollowMode = "time";
    expect(() => buildLabviewBdx(project, project.paths[0].id)).not.toThrow();
  });

  it("atomically preserves binary bytes", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "bordeaux-bdx-test-"));
    const file = path.join(directory, "path.bdx");
    const expected = buildLabviewBdx(createDemoProject()).buffer;
    await writeBufferAtomically(file, expected);
    expect(await fsp.readFile(file)).toEqual(expected);
    await fsp.rm(directory, { recursive: true, force: true });
  });
});

describe("canonical shipped renderer", () => {
  it("loads the maintained legacy editor with persistence, security, and accessibility hooks", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/legacy/index.html"), "utf8");
    const app = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/34f061c0-0a98-47ac-8cc1-537fad881fe6.js"), "utf8");
    const ui = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/760c13dd-1656-409e-a1f2-58b2285a7f6e.js"), "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(":focus-visible");
    expect(html).toContain(".numbox .numinput:focus-visible");
    expect(html).toContain("@container (max-width: 820px)");
    expect(html).toContain(".tb-file { flex: 0 0 auto");
    expect(html).toContain(".ctxinsp-t, .featnm");
    expect(app).toContain("openRecentProject");
    expect(app).toContain("saveProject");
    expect(app).not.toContain("bordeaux-notice");
    expect(ui).toContain("'aria-expanded': open");
    expect(ui).toContain("htmlFor: id");
    const panels = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/796cfac6-71d3-4f8c-a36f-363f52edf57f.js"), "utf8");
    const inspector = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/7efa12ca-9f23-45f3-8ac7-e2dc8d3c0bc1.js"), "utf8");
    expect(panels).toContain("'aria-label': 'Export .bdx'");
    expect(panels).toContain("{ v: 'labviewBezier'");
    expect(panels).toContain("{ v: 'labviewClothoid'");
    expect(panels).toContain("exported samples remain authoritative");
    expect(inspector).toContain("Advanced .bdx flags");
    expect(inspector).not.toContain("StoopidFast");
    expect(inspector).toContain("Sample period");
    expect(inspector).toContain("Min radius");
  });

  it("lets the active constraint-range tool claim segment hit lines", () => {
    const field = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/f7c20d72-d5b2-464c-b0cb-59923213228e.js"), "utf8");
    expect(field).toContain("if (tool === 'range' && pts.length > 1) { startRangeDrag(world, visit); return; }");
    expect(field).toContain("tool === 'waypoint' || tool === 'rotation' || tool === 'marker'");
    expect(field).toContain("tool === 'range' ? 'crosshair'");
  });

  it("uses the shared outline selection style for waypoints and segments", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/legacy/index.html"), "utf8");
    const outline = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/796cfac6-71d3-4f8c-a36f-363f52edf57f.js"), "utf8");
    expect(html).not.toContain(".wpfeatrow.sel,.segfeatrow.sel");
    expect(html).toContain(".featrow.sel{background:var(--accent-soft);border-left-color:var(--accent)}");
    expect(outline).toContain("featrow wpfeatrow");
    expect(outline).toContain("featrow segfeatrow");
    expect(outline).toContain("className: 'featindent'");
    expect(outline).toContain("typeName(w.segType)");
    expect(outline).toContain("wps.length > 2 && h('button', { className: 'featdel'");
  });

  it("renders the field metric overlay as a compact legend", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/legacy/index.html"), "utf8");
    const panels = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/796cfac6-71d3-4f8c-a36f-363f52edf57f.js"), "utf8");
    expect(html).toContain(".overlayctl{position:absolute;left:16px;bottom:110px;width:236px;background:transparent");
    expect(panels).not.toContain("className: 'ovlabel'");
    expect(panels.indexOf("className: 'ovsafety '")).toBeLessThan(panels.indexOf("className: 'ovlegend'"));
  });

  it("offers beginner robot-footprint presets and scales them with dimensions", () => {
    const robotPage = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/8ddc9855-091c-439c-b24a-f683fa800fb7.js"), "utf8");
    expect(robotPage).toContain("['rectangle', 'Rectangle'], ['round', 'Round'], ['trapezoid', 'Trapezoid'], ['custom', 'Custom']");
    expect(robotPage).toContain("const maxDim = Math.max(robot.w, robot.l, 0.4, ...footprint.flatMap");
    expect(robotPage).toContain("x: point.x * nextL / robot.l, y: point.y * nextW / robot.w");
    expect(robotPage).toContain("Custom convex vertices");
    expect(robotPage).toContain("disabled: footprint.length >= 16");
    expect(robotPage).toContain("disabled: footprint.length <= 3");
  });

  it("authors time or position following at path and segment scope", () => {
    const inspector = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/7efa12ca-9f23-45f3-8ac7-e2dc8d3c0bc1.js"), "utf8");
    expect(inspector).toContain("ariaLabel: 'Default path follow mode'");
    expect(inspector).toContain("ariaLabel: 'Segment follow mode'");
    expect(inspector).toContain("segmentFollowMode: v === 'inherit' ? undefined : v");
    expect(inspector).toContain("Java JSON only");
  });

  it("authors conditional repeated command schedules", () => {
    const inspector = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/7efa12ca-9f23-45f3-8ac7-e2dc8d3c0bc1.js"), "utf8");
    expect(inspector).toContain("ariaLabel: 'Event trigger'");
    expect(inspector).toContain("ariaLabel: 'Repeat event'");
    expect(inspector).toContain("ariaLabel: 'Limit event end time'");
    expect(inspector).toContain("id: 'event-condition-id'");
  });

  it("keeps playback, direct target rotation, and shift-delete wired into the editor", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/34f061c0-0a98-47ac-8cc1-537fad881fe6.js"), "utf8");
    const field = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/f7c20d72-d5b2-464c-b0cb-59923213228e.js"), "utf8");
    expect(app).toContain("const togglePlayback = useCallback");
    expect(app).toContain("playRef.current >= totalNow - 1e-3");
    expect(field).toContain("'data-role': 'rth'");
    expect(field).toContain("actions.rotateTargetTo(d.idx, world, e.shiftKey)");
    expect(field).toContain("(role === 'rt' || role === 'rth') && actions.delTarget");
    expect(field).toContain("role === 'em' && actions.delMarker");
    expect(field).toContain("(role === 'cr' || role === 'rs' || role === 're') && actions.delRange");
    expect(field).toContain("if (actions.openInspector) actions.openInspector()");
    expect(field).toContain("!e.altKey && !candidateInspectDouble");
  });

  it("supports distance-locked targets, markers, and range controls", () => {
    const inspector = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets/7efa12ca-9f23-45f3-8ac7-e2dc8d3c0bc1.js"), "utf8");
    expect(PM.featureFraction({ f: 0.8, anchor: "dist", d: 2 }, { length: 10 })).toBeCloseTo(0.2);
    expect(inspector).toContain("'Position lock'");
    expect(inspector).toContain("label: 'Path %'");
    expect(inspector).toContain("label: 'Distance'");
  });

  it("keeps waypoint-locked range endpoints attached through structural edits", () => {
    const range = { anchor: "wp", w0: 1, w1: 3 };
    expect(PM.remapWaypointRange(range, [0, 2, 3, 4], undefined, 5)).toMatchObject({ w0: 2, w1: 4 });
    expect(PM.remapWaypointRange(range, [0, 3, 1, 2], undefined, 4)).toMatchObject({ w0: 2, w1: 3 });
    expect(PM.remapWaypointRange(range, [0, null, 1, 2], 1, 3)).toMatchObject({ w0: 1, w1: 2 });
    expect(PM.remapWaypointRange({ anchor: "wp", w0: 3, w1: 3 }, [0, 1, 2, null], 3, 3)).toMatchObject({ w0: 2, w1: 2 });
  });

  it("keeps local range endpoints within their segments as earlier geometry changes", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 6, y: 0 }, { x: 10, y: 0 }]);
    path.ranges = [{
      anchor: "wp", f0: 0.3, f1: 0.5, w0: 1, t0: 0.25, w1: 1, t1: 0.75,
      maxVel: 2, maxAccel: 2, maxDecel: 2, maxAngVel: 180, maxAngAccel: 360,
    }];
    const point = (s: number) => ({ x: s, y: 0, s, heading: 0, curv: 0, seg: 0, t: 0 });
    const before = PM.effectiveRanges(path, { pts: [point(0), point(2), point(6), point(10)], length: 10 })[0];
    const after = PM.effectiveRanges(path, { pts: [point(0), point(4), point(7), point(10)], length: 10 })[0];

    expect(before).toMatchObject({ f0: 0.3, f1: 0.5 });
    expect(after).toMatchObject({ f0: 0.475, f1: 0.625 });
    expect(PM.remapWaypointRange(path.ranges[0], [3, 2, 1, 0], undefined, 4)).toMatchObject({ w0: 1, t0: 0.25, w1: 1, t1: 0.75 });
    expect(PM.remapWaypointRange({ ...path.ranges[0], w0: 1, t0: 0.2, w1: 3, t1: undefined }, [3, 2, 1, 0], undefined, 4)).toMatchObject({ w0: 0, t0: 0, w1: 1, t1: 0.8 });
  });
});

describe("project file boundary", () => {
  it("repairs non-stop tangent discontinuities while preserving stopped corners", () => {
    const project = createDemoProject();
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1 },
      { x: 3, y: 2 },
      { x: 6, y: 2 },
    ]);
    const moving = project.paths[0].waypoints[1];
    moving.linked = false;
    moving.corner = true;
    moving.prevC = { x: 3, y: 1 };
    moving.nextC = { x: 4, y: 2 };
    const repaired = parseProject(JSON.stringify(project)).paths[0].waypoints[1];
    const incoming = { x: repaired.x - repaired.prevC.x, y: repaired.y - repaired.prevC.y };
    const outgoing = { x: repaired.nextC.x - repaired.x, y: repaired.nextC.y - repaired.y };
    expect(repaired.linked).toBe(true);
    expect(repaired.corner).toBe(false);
    expect(Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x)).toBeLessThan(1e-6);
    expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeGreaterThan(0);

    moving.stop = true;
    const stopped = parseProject(JSON.stringify(project)).paths[0].waypoints[1];
    expect(stopped.linked).toBe(false);
    expect(stopped.corner).toBe(true);
    expect(stopped.prevC).toEqual({ x: 3, y: 1 });
    expect(stopped.nextC).toEqual({ x: 4, y: 2 });
  });

  it("normalizes legacy numeric routine references on open", () => {
    const project = createDemoProject() as unknown as Record<string, any>;
    delete project.paths[0].id;
    project.routine.nodes = [{ id: "legacy", type: "path", ref: 0 }];
    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.paths[0].id).toMatch(/^path_/);
    expect((parsed.routine!.nodes[0] as { ref: string }).ref).toBe(parsed.paths[0].id);
  });

  it("opens unversioned project files through the legacy reader", () => {
    const project = createDemoProject() as unknown as Record<string, any>;
    delete project.schemaVersion;
    delete project.paths[0].id;
    project.routine.nodes = [{ id: "legacy", type: "path", ref: 0 }];
    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.schemaVersion).toBe("1.0");
    expect((parsed.routine!.nodes[0] as { ref: string }).ref).toBe(parsed.paths[0].id);
  });

  it("opens the browser fallback's version 2 .path format", () => {
    const fixture = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/projects/browser-path-v2.path"), "utf8");
    const parsed = parseProject(fixture);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.name).toBe("Legacy Browser Path");
    expect(parsed.paths).toHaveLength(1);
    expect(parsed.paths[0].name).toBe("Legacy Browser Path");
    expect(parsed.paths[0].id).toMatch(/^path_/);
    expect(parsed.robot).toEqual({ drive: "swerve", w: 0.84, l: 0.84, maxSpeed: 5 });
    expect(parsed.paths[0].waypoints[0]).toEqual(expect.objectContaining({
      x: 1,
      y: 2,
      prevC: { x: 0.75, y: 2 },
      nextC: { x: 1.25, y: 2 },
    }));
    expect(parsed.paths[0].constraints).toEqual(expect.objectContaining({ maxVel: 4.2, maxAccel: 6.5 }));
    expect(parsed.paths[0].headingMode).toBe("targets");
    expect(parsed.paths[0].exportable).toBe(true);
    expect(parsed.routine?.nodes).toEqual([]);
  });

  it("does not treat an unversioned standalone path as browser path 2.0", () => {
    const pathDocument = blankPath("Ambiguous") as unknown as Record<string, unknown>;
    expect(() => parseProject(JSON.stringify(pathDocument))).toThrow(/Invalid Bordeaux project/);
  });

  it("forces imported and migrated files to Save As without changing the source", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "bordeaux-import-test-"));
    const source = path.join(directory, "legacy.path");
    const destination = path.join(directory, "imported.bordeaux.json");
    const fixture = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/projects/browser-path-v2.path"), "utf8");
    await fsp.writeFile(source, fixture, "utf8");
    const opened = await readProject(source);
    expect(opened.migrated).toBe(true);
    expect(saveTargetForOpenedProject(source, opened)).toBeNull();
    await writeProject(destination, opened.project);
    expect(await fsp.readFile(source, "utf8")).toBe(fixture);
    expect(parseProject(await fsp.readFile(destination, "utf8")).name).toBe("Legacy Browser Path");
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it("reports corrupt JSON and unsupported versions clearly", () => {
    expect(() => parseProject("{not json"))
      .toThrow("Invalid Bordeaux project: the file is not valid JSON.");
    expect(() => parseProject(JSON.stringify({ ...createDemoProject(), schemaVersion: "9.0" })))
      .toThrow(/Unsupported Bordeaux project schema version "9\.0"/);
  });

  it("does not persist transient editor selection state", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "bordeaux-test-"));
    const file = path.join(directory, "project.json");
    const project = createDemoProject() as unknown as Record<string, any>;
    project.paths[0]._selR = 0;
    project.paths[0].waypoints[0]._selAfter = true;
    project.paths[0]._selectionPolicy = "preserve extension data";
    project.paths[0].compatibilityNote = "preserve known-safe extension data";
    await writeProject(file, project);
    const saved = JSON.parse(await fsp.readFile(file, "utf8"));
    expect(saved.paths[0]._selR).toBeUndefined();
    expect(saved.paths[0].waypoints[0]._selAfter).toBeUndefined();
    expect(saved.paths[0]._selectionPolicy).toBe("preserve extension data");
    expect(saved.paths[0].compatibilityNote).toBe("preserve known-safe extension data");
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it("leaves an existing file untouched when validation fails", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "bordeaux-test-"));
    const file = path.join(directory, "project.json");
    await fsp.writeFile(file, "original\n", "utf8");
    await expect(writeProject(file, { paths: "bad" })).rejects.toThrow(/Invalid Bordeaux project/);
    expect(await fsp.readFile(file, "utf8")).toBe("original\n");
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it("serializes same-target atomic saves in invocation order", async () => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "bordeaux-test-"));
    const file = path.join(directory, "project.json");
    const first = createDemoProject(); first.name = "First";
    const second = createDemoProject(); second.name = "Second";
    await Promise.all([writeProject(file, first), writeProject(file, second)]);
    expect(JSON.parse(await fsp.readFile(file, "utf8")).name).toBe("Second");
    expect((await fsp.readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await fsp.rm(directory, { recursive: true, force: true });
  });
});

describe("clothoid chains", () => {
  it("blends the shared tangent across consecutive clothoid segments", () => {
    const waypoints = [
      {
        x: 0,
        y: 0,
        theta: 0,
        thetaOn: true,
        linked: true,
        stop: false,
        segType: "clothoid",
        prevC: { x: -1, y: 0 },
        nextC: { x: 1, y: 0 },
      },
      {
        x: 2,
        y: 1,
        theta: 0,
        thetaOn: false,
        linked: false,
        stop: false,
        segType: "clothoid",
        prevC: { x: 1, y: 1 },
        nextC: { x: 3, y: 2 },
      },
      {
        x: 4,
        y: 1,
        theta: 0,
        thetaOn: true,
        linked: true,
        stop: false,
        prevC: { x: 3, y: 0 },
        nextC: { x: 5, y: 1 },
      },
    ];

    const sampled = PM.sample(waypoints, 80);
    const joint = sampled.pts.find((point: any) => point.seg === 0 && point.t === 1);
    const firstAfterJoint = sampled.pts.find((point: any) => point.seg === 1);
    const expectedBlend = Math.PI / 8;

    if (!joint || !firstAfterJoint) throw new Error("Expected sampled clothoid joint points");
    expect(joint.heading).toBeCloseTo(expectedBlend, 2);
    expect(firstAfterJoint.heading).toBeCloseTo(expectedBlend, 1);
    expect(Math.abs(PM.angWrap(firstAfterJoint.heading - joint.heading))).toBeLessThan(0.08);
    expect(Math.abs(firstAfterJoint.curv - joint.curv)).toBeLessThan(0.8);
  });
});
