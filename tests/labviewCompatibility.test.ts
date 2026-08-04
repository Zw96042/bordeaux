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

  it("resolves heading mode independently for each segment", () => {
    const project = createDemoProject();
    project.plannerId = "labviewBezier";
    const pathDoc = project.paths[0];
    pathDoc.headingMode = "tangent";
    pathDoc.constraints.maxJerk = 100;
    pathDoc.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 90, nextC: { x: 2, y: 2 }, segmentHeadingMode: "tangent" },
      { x: 4, y: 2, theta: 90, prevC: { x: 3, y: 2 }, nextC: { x: 5, y: 2 }, segmentHeadingMode: "targets" },
      { x: 7, y: 2, theta: 90, prevC: { x: 6, y: 2 } },
    ]);
    pathDoc.targets = [{ f: 0.75, deg: 180 }];

    const result = getPlanner("labviewBezier").generate({ path: pathDoc, robot: project.robot });
    const firstSegment = result.samples.find((sample) => sample.f > 0.2)!;
    const secondSegment = result.samples.find((sample) => sample.f > 0.7)!;

    expect(firstSegment.headingRad).toBeCloseTo(0, 5);
    expect(secondSegment.headingRad).toBeGreaterThan(Math.PI / 2);
  });

  it("generates signed vertex-blend clothoids without removing the current G1 option", () => {
    const project = createDemoProject();
    project.plannerId = "labviewClothoid";
    project.paths[0].labview = { samplePeriodS: 0.02, minTurnRadiusM: 0.4, bezierTangentMode: "handles" };
    project.paths[0].constraints.maxJerk = 100;
    project.paths[0].waypoints = buildWaypoints([
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
    ]);
    const result = getPlanner("labviewClothoid").generate({ path: project.paths[0], robot: project.robot });

    expect(result.planner).toBe("labviewClothoid");
    expect(result.samples[0]).toMatchObject({ x: 1, y: 1 });
    expect(result.samples.at(-1)!.x).toBeCloseTo(4, 8);
    expect(result.samples.at(-1)!.y).toBeCloseTo(4, 8);
    expect(Math.max(...result.samples.map((sample) => sample.curvatureInvM))).toBeGreaterThan(0.5);
    expect(getPlanner("profiledSpline").id).toBe("profiledSpline");

    const decoded = parseLabviewBdx(buildLabviewBdx(project, project.paths[0].id).buffer);
    expect(decoded.pathType).toBe("clothoid");
    expect(decoded.trajectory[0].type).toBe("blend");
  });

  it.each(["labviewBezier", "labviewClothoid"] as const)("reduces %s acceleration along the motor torque-speed line", (plannerId) => {
    const project = createDemoProject();
    project.plannerId = plannerId;
    project.robot.maxSpeed = 5;
    const pathDoc = project.paths[0];
    pathDoc.constraints.maxVel = 5;
    pathDoc.constraints.maxAccel = 6;
    pathDoc.constraints.maxDecel = 6;
    pathDoc.constraints.maxJerk = 1_000;
    pathDoc.ranges = [{ anchor: "param", f0: 0, f1: 1, maxVel: 5, maxAccel: 3, maxDecel: 6, maxAngVel: 540, maxAngAccel: 720 }];
    pathDoc.labview = { ...pathDoc.labview, samplePeriodS: 0.01 };
    pathDoc.waypoints = buildWaypoints([{ x: 0.5, y: 1 }, { x: 15.5, y: 1 }]);

    const result = getPlanner(plannerId).generate({ path: pathDoc, robot: project.robot });
    const accelerating = result.samples.slice(1).map((sample, index) => ({ sample, previous: result.samples[index] }))
      .filter(({ sample, previous }) => sample.velocityMps > previous.velocityMps + 1e-6);

    expect(accelerating.length).toBeGreaterThan(20);
    accelerating.forEach(({ sample, previous }) => {
      const motorLimit = pathDoc.ranges[0].maxAccel * Math.max(0, 1 - previous.velocityMps / project.robot.maxSpeed);
      expect(sample.accelerationMps2).toBeLessThanOrEqual(motorLimit * 1.04 + 1e-3);
    });
    const lowSpeed = accelerating.filter(({ previous }) => previous.velocityMps < 1);
    const highSpeed = accelerating.filter(({ previous }) => previous.velocityMps > 3);
    expect(highSpeed.length).toBeGreaterThan(0);
    expect(Math.max(...highSpeed.map(({ sample }) => sample.accelerationMps2)))
      .toBeLessThan(Math.max(...lowSpeed.map(({ sample }) => sample.accelerationMps2)));
  });

  it("uses fixture-backed LabVIEW metadata for a straight clothoid path", () => {
    // Conventions confirmed by LabVIEW-generated 2CycleDepotPart1.bdx
    // (SHA-256 5ee07b8aa234f9ec19613245af25ee38fd9ff1b701f2e7b745b4d79dab7ee64f).
    const metersPerFoot = 0.3048;
    const project = createDemoProject();
    project.plannerId = "labviewClothoid";
    project.robot.maxSpeed = 14 * metersPerFoot;
    const pathDoc = project.paths[0];
    pathDoc.waypoints = buildWaypoints([
      { x: 1.9662723541259766 * metersPerFoot, y: 14.616308212280273 * metersPerFoot, theta: 360, segType: "clothoid" },
      { x: 1.966299057006836 * metersPerFoot, y: 22.961009979248047 * metersPerFoot, theta: 360 },
    ]);
    pathDoc.startVel = 0;
    pathDoc.goalVel = 14 * metersPerFoot;
    pathDoc.constraints = {
      maxVel: 14 * metersPerFoot,
