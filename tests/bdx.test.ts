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
});

describe("legacy renderer patches", () => {
  it("keeps shift-click deletion wired into the generated field bundle", () => {
    const fieldBundle = fs
      .readdirSync(path.join(process.cwd(), "public/legacy/assets"))
      .find((file) => fs.readFileSync(path.join(process.cwd(), "public/legacy/assets", file), "utf8").startsWith("// Bordeaux — interactive field view"));

    if (!fieldBundle) throw new Error("Could not find generated FieldView bundle");
    const source = fs.readFileSync(path.join(process.cwd(), "public/legacy/assets", fieldBundle), "utf8");
    expect(source).toContain("role === 'wp' && e.shiftKey");
    expect(source).toContain("idx > 0 && idx < doc.waypoints.length - 1");
    expect(source).toContain("actions.delWp");
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

