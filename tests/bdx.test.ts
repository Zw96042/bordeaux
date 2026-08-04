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

  it("round-trips path folders and per-segment heading modes", () => {
    const project = createDemoProject();
    project.pathFolders = [{ id: "folder_scoring", name: "Scoring" }];
    project.paths[0].folderId = "folder_scoring";
    project.paths[0].waypoints[0].segmentHeadingMode = "tangent";

    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.pathFolders).toEqual(project.pathFolders);
    expect(parsed.paths[0].folderId).toBe("folder_scoring");
    expect(parsed.paths[0].waypoints[0].segmentHeadingMode).toBe("tangent");
  });

  it("rejects orphan folders and invalid per-segment heading modes", () => {
    const project = createDemoProject() as unknown as Record<string, any>;
    project.pathFolders = [{ id: "folder_one", name: "One" }];
    project.paths[0].folderId = "folder_missing";
    project.paths[0].waypoints[0].segmentHeadingMode = "locked";

    const validation = validateProject(project);
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((item) => item.path)).toEqual(expect.arrayContaining([
      "$.paths[0].folderId",
      "$.paths[0].waypoints[0].segmentHeadingMode",
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
