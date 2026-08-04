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

