import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLabviewBdx } from "../src/shared/export/labviewBdx";
import { parseLabviewBdx } from "../src/shared/export/labviewBdxReader";
import { getPlanner } from "../src/shared/planners";
import { buildBdxExport } from "../src/shared/export/bdx";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import { decodeLabviewBdxProject } from "../src/shared/project/labviewImport";
import { readProject } from "../src/electron/projectFiles";

describe("additive LabVIEW planner compatibility", () => {
  it("keeps projects without compatibility fields on the original planner", () => {
    const legacy = createDemoProject() as unknown as Record<string, any>;
    delete legacy.plannerId;
    delete legacy.paths[0].labview;
    const decoded = decodeProjectFile(JSON.stringify(legacy));

    expect(decoded.project.plannerId).toBeUndefined();
    expect(decoded.project.paths[0].labview).toEqual({
      samplePeriodS: 0.02,
      minTurnRadiusM: 0.5,
      bezierTangentMode: "handles",
      reversePath: false,
      zeroVelocity: false,
      pickupBalls: false,
      currentLimit: 0,
      zeroTranslationalVelocity: false,
      correctAtBeginningOfPath: false,
    });
    expect(buildBdxExport(decoded.project).paths[0].planner).toBe("profiledSpline");
  });

  it("generates a fixed-period quintic Bezier compatibility trajectory", () => {
    const project = createDemoProject();
    project.plannerId = "labviewBezier";
    project.paths[0].labview = { samplePeriodS: 0.01, minTurnRadiusM: 0.5, bezierTangentMode: "handles" };
    project.paths[0].constraints.maxJerk = 100;
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1, theta: 0, nextC: { x: 2, y: 1 } },
      { x: 4, y: 3, theta: 45, prevC: { x: 3, y: 2 }, nextC: { x: 5, y: 4 } },
      { x: 7, y: 3, theta: 0, prevC: { x: 6, y: 3 } },
    ]);
    const result = getPlanner("labviewBezier").generate({ path: project.paths[0], robot: project.robot });

    expect(result.planner).toBe("labviewBezier");
    expect(result.samples.length).toBeGreaterThan(20);
    result.samples.forEach((sample, index) => expect(sample.t).toBeCloseTo(index * 0.01, 10));
    expect(result.samples[0]).toMatchObject({ x: 1, y: 1 });
    expect(result.samples.at(-1)!.x).toBeCloseTo(7, 8);
    expect(result.samples.at(-1)!.y).toBeCloseTo(3, 8);
    expect(result.samples.some((sample) => Math.abs(sample.curvatureInvM) > 1e-3)).toBe(true);
    expect(Math.max(...result.samples.map((sample) => Math.abs(sample.accelerationMps2)))).toBeLessThanOrEqual(project.paths[0].constraints.maxAccel * 1.02);
    const jerk = result.samples.slice(2).map((sample, index) => Math.abs(sample.accelerationMps2 - result.samples[index + 1].accelerationMps2) / 0.01);
    expect(Math.max(...jerk)).toBeLessThanOrEqual(project.paths[0].constraints.maxJerk! * 1.03);

    const encoded = buildLabviewBdx(project, project.paths[0].id);
    const decoded = parseLabviewBdx(encoded.buffer);
    expect(decoded.pathType).toBe("bezier");
    expect(decoded.trajectory[0].type).toBe("bezier");
    expect(decoded.conditions.samplePeriodS).toBe(0.01);
    expect(decoded.trajectory[0].positions).toHaveLength(result.samples.length);
  });

  it("lets a stopped Bezier waypoint use independent incoming and outgoing tangents", () => {
    const project = createDemoProject();
    project.plannerId = "labviewBezier";
    project.paths[0].headingMode = "tangent";
    project.paths[0].constraints.maxJerk = 100;
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1, nextC: { x: 2, y: 1 } },
      { x: 4, y: 1, stop: true, linked: false, prevC: { x: 3, y: 1 }, nextC: { x: 4, y: 2 } },
      { x: 4, y: 5, prevC: { x: 4, y: 4 } },
    ]);

    const result = getPlanner("labviewBezier").generate({ path: project.paths[0], robot: project.robot });
    const stopIndex = result.samples.reduce((best, sample, index) => (
      Math.hypot(sample.x - 4, sample.y - 1) < Math.hypot(result.samples[best].x - 4, result.samples[best].y - 1) ? index : best
    ), 0);
    const incoming = [...result.samples.slice(0, stopIndex)].reverse().find((sample) => sample.x < 3.99)!;
    const outgoing = result.samples.slice(stopIndex).find((sample) => sample.y > 1.2)!;

    expect(result.samples.slice(0, stopIndex + 1).every((sample) => Math.abs(sample.y - 1) < 1e-8)).toBe(true);
    expect(result.samples.slice(stopIndex).every((sample) => Math.abs(sample.x - 4) < 1e-8)).toBe(true);
    expect(incoming.headingRad).toBeCloseTo(0, 6);
    expect(outgoing.headingRad).toBeCloseTo(Math.PI / 2, 6);
  });

