import { describe, expect, it } from "vitest";
import { analyzePath } from "../src/shared/agent/pathAnalysis";
import { outgoingSegmentTangentHeading } from "../src/shared/math/pathTangents";
import { getPlanner } from "../src/shared/planners";
import { applyStationaryActions } from "../src/shared/planners/stationaryActions";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { motorAccelerationAtSpeed } from "../src/shared/robotLimits";
import type { PlannerResult } from "../src/shared/types";
import { validateProject } from "../src/shared/validation";

const PLANNERS = ["profiledSpline", "optimizedTrajectory"] as const;

function expectMonotonic(values: readonly number[], tolerance = 1e-9): void {
  for (let index = 1; index < values.length; index += 1) {
    expect(values[index], `value ${index} regressed from ${values[index - 1]}`).toBeGreaterThanOrEqual(values[index - 1] - tolerance);
  }
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x1_0000_0000;
  };
}

function between(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random();
}

describe("math audit regressions", () => {
  it.each(PLANNERS)("keeps distance and fraction monotonic through an interior jiggle in %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 2, y: 4, theta: 0, thetaOn: true, segType: "line" },
      {
        x: 4,
        y: 4,
        theta: 0,
        thetaOn: true,
        stop: true,
        segType: "line",
        jiggle: { distanceM: 0.1, strokes: 2, startDeg: 90, stepDeg: 180, strokeTimeS: 0.4 },
      },
      { x: 7, y: 4, theta: 0, thetaOn: true, segType: "line" },
    ]);

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const arrival = result.waypointSampleIndices![1];
    const departure = result.samples.findIndex((sample, index) => index > arrival && sample.x > 4.001);
    const action = result.samples.slice(arrival + 1, departure);

    expect(action.length).toBeGreaterThan(0);
    expect(action.every((sample) => Math.abs(sample.f - result.samples[arrival].f) < 1e-9)).toBe(true);
    expectMonotonic(result.samples.map((sample) => sample.s));
    expectMonotonic(result.samples.map((sample) => sample.f));
    expect(result.samples.at(-1)!.s).toBeCloseTo(result.totalDistanceM, 4);
  });

  it("analyzes complete drivetrain models against their effective physical envelope", () => {
    const project = createDemoProject();
    project.robot.driveModel = {
      motorId: "test",
      motorFreeRpm: 6000,
      motorMaxTorqueNm: 1,
      motorCount: 4,
      gearRatio: 10,
      wheelDiameterM: 0.1,
      massKg: 40,
      moiKgM2: 10,
      wheelbaseM: 0.6,
      trackwidthM: 0.8,
      wheelFrictionCoefficient: 0.5,
    };
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, stop: true, segType: "line" },
      { x: 7, y: 1, stop: true, segType: "line" },
    ]);
    path.constraints = {
      ...path.constraints,
      maxVel: 0.1,
      maxAccel: 0.1,
      maxDecel: 0.1,
      maxAngVel: 1,
      maxAngAccel: 1,
      maxAngDecel: 1,
    };

    const analysis = analyzePath(project, path.id);

    expect(analysis.extrema.find((item) => item.metric === "velocity")!.value).toBeGreaterThan(1);
    expect(analysis.findings.some((finding) => finding.id.startsWith("constraint:"))).toBe(false);
  });

  it("keeps distance-range analysis anchored to geometry when a terminal jiggle adds travel", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 4, stop: true, segType: "line" },
      {
        x: 7,
        y: 4,
        stop: true,
        segType: "line",
        jiggle: { distanceM: 0.2, strokes: 2, startDeg: 90, stepDeg: 180, strokeTimeS: 0.4 },
      },
    ]);
    path.ranges = [{
      anchor: "dist",
      f0: 0.7,
      f1: 0.8,
      maxVel: 0.1,
      maxAccel: path.constraints.maxAccel,
      maxDecel: path.constraints.maxDecel,
      maxAngVel: path.constraints.maxAngVel,
      maxAngAccel: path.constraints.maxAngAccel,
    }];

    const analysis = analyzePath(project, path.id);

    expect(analysis.findings.some((finding) => finding.id === "constraint:velocity")).toBe(false);
  });

  it("keeps later distance ranges anchored to geometry after an interior jiggle", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 4, stop: true, segType: "line" },
      {
        x: 4,
        y: 4,
        stop: true,
        segType: "line",
        jiggle: { distanceM: 0.2, strokes: 2, startDeg: 90, stepDeg: 180, strokeTimeS: 0.4 },
      },
      { x: 7, y: 4, stop: true, segType: "line" },
    ]);
    path.ranges = [{
      anchor: "dist",
      f0: 0.75,
      f1: 1,
      d0: 4.5,
      d1: 6,
      maxVel: 0.1,
      maxAccel: path.constraints.maxAccel,
      maxDecel: path.constraints.maxDecel,
      maxAngVel: path.constraints.maxAngVel,
      maxAngAccel: path.constraints.maxAngAccel,
    }];

    const analysis = analyzePath(project, path.id);

    expect(analysis.findings.some((finding) => finding.id === "constraint:velocity")).toBe(false);
  });

  it.each(PLANNERS)("honors low positive acceleration and centripetal limits in %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 2, y: 2, stop: true, segType: "arc" },
      { x: 4, y: 4, stop: true, segType: "line" },
    ]);
    path.waypoints[0].nextC = { x: 3, y: 2 };
    path.constraints = {
      ...path.constraints,
      maxVel: 1,
      maxAccel: 0.01,
      maxDecel: 0.01,
      maxCentripetalAccel: 0.01,
    };

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const peakAcceleration = Math.max(...result.samples.map((sample) => Math.abs(sample.accelerationMps2)));
    const peakLateralAcceleration = Math.max(...result.samples.map((sample) => (
      sample.velocityMps ** 2 * Math.abs(sample.curvatureInvM)
    )));

    expect(result.totalTimeS).toBeGreaterThan(20);
    expect(peakAcceleration).toBeLessThanOrEqual(0.0105);
    expect(peakLateralAcceleration).toBeLessThanOrEqual(0.0105);
  });

  it.each(PLANNERS)("rejects a sampling density that cannot represent stopped segment motion in %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 4, stop: true, segType: "line" },
      { x: 7, y: 4, stop: true, segType: "line" },
    ]);

    expect(() => getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 1 }))
      .toThrow("at least 2");
  });

  it("rejects an unmodeled heading jump at a stopped tangent corner", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 2, y: 2, stop: true, segType: "line" },
      { x: 5, y: 2, stop: true, segType: "line" },
      { x: 5, y: 5, stop: true },
    ]);

    const invalid = validateProject(project);
    expect(invalid.ok).toBe(false);
    expect(invalid.issues).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("waypoints[1].turnInPlace"),
      message: expect.stringContaining("stopped tangent corner"),
    }));

    path.waypoints[1].turnInPlace = { headingDeg: 90 };
    expect(validateProject(project).ok).toBe(true);
    PLANNERS.forEach((plannerId) => {
      const result = getPlanner(plannerId).generate({ path, robot: project.robot });
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error"), plannerId).toBe(false);
      expect(result.samples.every((sample, index) => index === 0 || sample.t > result.samples[index - 1].t), plannerId).toBe(true);
    });
  });

  it.each(PLANNERS)("accepts an exact tangent turn before a curved %s departure at low density", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, stop: true, segType: "line" },
      { x: 4, y: 2, stop: true, segType: "clothoid" },
      { x: 7, y: 5, stop: true },
    ]);
    const corner = path.waypoints[1];
    corner.turnInPlace = {
      headingDeg: Math.atan2(corner.nextC.y - corner.y, corner.nextC.x - corner.x) * 180 / Math.PI,
    };

    const result = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 2 });
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error"), plannerId).toBe(false);
    expect(result.samples.filter((sample) => Math.hypot(sample.x - corner.x, sample.y - corner.y) < 1e-5).length)
      .toBeGreaterThan(2);
  });

  it.each(PLANNERS)("keeps a stopped tangent transition continuous across the ±π branch in %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 8, y: 4, stop: true, segType: "line" },
      { x: 5, y: 4, stop: true, segType: "line" },
      { x: 2, y: 4 - 1e-6, stop: true, segType: "line" },
    ]);

    expect(validateProject(project).ok).toBe(true);
    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const boundary = result.waypointSampleIndices![1];
    const wrappedStep = Math.atan2(
      Math.sin(result.samples[boundary + 1].headingRad - result.samples[boundary - 1].headingRad),
      Math.cos(result.samples[boundary + 1].headingRad - result.samples[boundary - 1].headingRad),
    );

    expect(Math.abs(wrappedStep)).toBeLessThan(1e-5);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("checks real angular deceleration after a zero-angle turn boundary is expanded", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.constraints.maxAngAccel = 30;
    path.constraints.maxAngDecel = 30;
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, segType: "line" },
      { x: 4, y: 2, stop: true, segType: "line", turnInPlace: { headingDeg: 0 } },
      { x: 7, y: 2 },
    ]);
    const sample = (i: number, t: number, s: number, x: number, headingRad: number, velocityMps: number) => ({
      i, t, s, f: s / 6, x, y: 2, headingRad, velocityMps,
      accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0,
    });
    const base: PlannerResult = {
      planner: "profiledSpline",
      totalTimeS: 2.5,
      totalDistanceM: 6,
      samples: [
        sample(0, 0, 0, 1, -0.3, 1),
        sample(1, 1, 2, 3, 0, 1),
        sample(2, 1.5, 3, 4, 0, 0),
        sample(3, 2.5, 6, 7, 0, 0),
      ],
      waypointSampleIndices: [0, 2, 3],
      markers: [],
      diagnostics: [],
    };

    const result = applyStationaryActions(path, base, project.robot);
    const boundary = result.waypointSampleIndices![1];
    const angularDeceleration = Math.abs(
      (result.samples[boundary].angularVelocityRadps - result.samples[boundary - 1].angularVelocityRadps)
      / (result.samples[boundary].t - result.samples[boundary - 1].t),
    );
    expect(result.totalTimeS).toBeGreaterThan(base.totalTimeS);
    expect(angularDeceleration).toBeLessThanOrEqual(30 * Math.PI / 180 * 1.01);
  });

  it("keeps optimized local constraints on their unrounded sample boundary", () => {
    const project = createDemoProject();
    project.plannerId = "optimizedTrajectory";
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 4, stop: true, segType: "line" },
      { x: 16, y: 4, stop: true, segType: "line" },
    ]);
    path.ranges = [{
      anchor: "param",
      f0: 0.035713,
      f1: 0.2,
      maxVel: path.constraints.maxVel,
      maxAccel: 0.5,
      maxDecel: path.constraints.maxDecel,
      maxAngVel: path.constraints.maxAngVel,
      maxAngAccel: path.constraints.maxAngAccel,
    }];

    const analysis = analyzePath(project, path.id, { minimumClearanceM: 0 });
    expect(analysis.findings.filter((finding) => finding.kind === "constraint")).toEqual([]);
  });

  it("rejects partial electrical models and malformed range anchors", () => {
    const project = createDemoProject();
    project.robot.driveModel = {
      motorId: "partial",
      motorFreeRpm: 6000,
      gearRatio: 6.75,
      wheelDiameterM: 0.1016,
      motorStallCurrentA: 366,
    };
    project.paths[0].ranges = [{
      anchor: "wp",
      f0: -0.1,
      f1: 1.1,
      w0: 0.5,
      w1: 99,
      maxVel: 1,
      maxAccel: 1,
      maxDecel: 1,
      maxAngVel: 90,
      maxAngAccel: 180,
    }];

    const paths = validateProject(project).issues.map((issue) => issue.path);

    expect(paths).toContain("$.robot.driveModel");
    expect(paths).toContain("$.paths[0].ranges[0].f0");
    expect(paths).toContain("$.paths[0].ranges[0].f1");
    expect(paths).toContain("$.paths[0].ranges[0].w0");
    expect(paths).toContain("$.paths[0].ranges[0].w1");
  });

  it.each(PLANNERS)("keeps moving timing unchanged when a terminal jiggle follows distance ranges in %s", (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxAngVel = 360;
    path.constraints.maxAngAccel = 720;
    path.constraints.maxAngDecel = 720;
    path.waypoints = buildWaypoints([
      { x: 1, y: 4, theta: 0, thetaOn: true, stop: true, segType: "line" },
      { x: 7, y: 4, theta: 180, thetaOn: true, stop: true, segType: "line" },
    ]);
    path.ranges = [{
      anchor: "dist",
      f0: 0.75,
      f1: 1,
      d0: 4.5,
      d1: 6,
      maxVel: path.constraints.maxVel,
      maxAccel: path.constraints.maxAccel,
      maxDecel: path.constraints.maxDecel,
      maxAngVel: 25,
      maxAngAccel: 50,
    }];
    const withoutAction = getPlanner(plannerId).generate({ path: structuredClone(path), robot: project.robot });
    path.waypoints.at(-1)!.jiggle = {
      distanceM: 0.2,
      strokes: 2,
      startDeg: 90,
      stepDeg: 180,
      strokeTimeS: 0.5,
    };

    const withAction = getPlanner(plannerId).generate({ path, robot: project.robot });
    const arrival = withAction.waypointSampleIndices!.at(-1)!;

    expect(withAction.samples.slice(0, arrival + 1).map((sample) => sample.t))
      .toEqual(withoutAction.samples.map((sample) => sample.t));
    expect(withAction.samples.slice(0, arrival + 1).map((sample) => sample.velocityMps))
      .toEqual(withoutAction.samples.map((sample) => sample.velocityMps));
  });

  it.each(PLANNERS)("uses current-limited acceleration instead of a legacy speed derate for %s jiggles", (plannerId) => {
    const project = createDemoProject();
    project.robot.driveModel = {
      motorId: "test",
      motorFreeRpm: 6000,
      motorMaxTorqueNm: 1,
      motorStallCurrentA: 100,
      motorCurrentLimitA: 20,
      motorCount: 4,
      gearRatio: 10,
      wheelDiameterM: 0.1,
      massKg: 40,
      moiKgM2: 10,
      wheelbaseM: 0.6,
      trackwidthM: 0.8,
      wheelFrictionCoefficient: 3,
      batteryNominalVoltage: 12,
      batteryInternalResistanceOhm: 1e-9,
    };
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 2, y: 4, stop: true, segType: "line" },
      {
        x: 6,
        y: 4,
        stop: true,
        segType: "line",
        jiggle: { distanceM: 0.1, strokes: 2, startDeg: 90, stepDeg: 180, strokeTimeS: 0.2 },
      },
    ]);

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const action = result.samples.slice(result.waypointSampleIndices!.at(-1)! + 1);
    const positiveAcceleration = action.filter((sample) => sample.accelerationMps2 > 0);

    expect(positiveAcceleration.length).toBeGreaterThan(0);
    expect(Math.max(...positiveAcceleration.map((sample) => sample.accelerationMps2))).toBeGreaterThan(3.5);
    positiveAcceleration.forEach((sample) => {
      expect(sample.accelerationMps2)
        .toBeLessThanOrEqual(motorAccelerationAtSpeed(project.robot, sample.velocityMps, path.constraints.maxAccel) + 0.05);
    });
  });

  it.each(PLANNERS)("preserves core trajectory invariants across seeded %s path variations", (plannerId) => {
    const segmentTypes = ["line", "bezier", "arc", "clothoid"] as const;
    const headingModes = ["manual", "tangent", "targets"] as const;
    for (let caseIndex = 0; caseIndex < 384; caseIndex += 1) {
      const random = randomSource(0xb0de_0000 + caseIndex);
      const project = createDemoProject();
      project.plannerId = plannerId;
      project.robot.drive = caseIndex % 5 === 0 ? "tank" : "swerve";
      if (caseIndex % 3 === 0) {
        project.robot.driveModel = {
          motorId: "audit",
          motorFreeRpm: between(random, 4800, 7000),
          motorMaxTorqueNm: between(random, 2.5, 7.5),
          motorStallCurrentA: between(random, 100, 400),
          motorCurrentLimitA: between(random, 35, 90),
          motorCount: 4,
          gearRatio: between(random, 5, 9),
          wheelDiameterM: between(random, 0.075, 0.153),
          massKg: between(random, 40, 68),
          moiKgM2: between(random, 4, 10),
          wheelbaseM: between(random, 0.5, 0.75),
          trackwidthM: between(random, 0.5, 0.75),
          wheelFrictionCoefficient: between(random, 0.8, 1.6),
          batteryNominalVoltage: between(random, 10.5, 13),
          batteryInternalResistanceOhm: between(random, 0.008, 0.04),
        };
      }
      const path = project.paths[0];
      path.headingMode = headingModes[caseIndex % headingModes.length];
      path.driveBackward = random() < 0.35;
      const waypointCount = 2 + Math.floor(random() * 5);
      path.waypoints = buildWaypoints(Array.from({ length: waypointCount }, (_, index) => ({
        x: 0.8 + index * (15.8 / (waypointCount - 1)),
        y: between(random, 0.8, 7.2),
        theta: between(random, -180, 180),
        thetaOn: true,
        segType: segmentTypes[(caseIndex + index) % segmentTypes.length],
        stop: index === 0 || index === waypointCount - 1 || (index > 0 && random() < 0.18),
        wait: index > 0 && index < waypointCount - 1 && random() < 0.12 ? between(random, 0.02, 0.25) : 0,
      })));
      path.waypoints.forEach((waypoint) => {
        if ((waypoint.wait ?? 0) > 0) waypoint.stop = true;
      });
      const tangentHeading = (index: number): number => {
        const waypoint = path.waypoints[index];
        const next = path.waypoints[index + 1];
        return (outgoingSegmentTangentHeading(path.waypoints, index)
          ?? Math.atan2(next.y - waypoint.y, next.x - waypoint.x)) * 180 / Math.PI;
      };
      if (project.robot.drive === "tank" || path.headingMode === "tangent") {
        path.waypoints.slice(1, -1).forEach((waypoint, offset) => {
          if (waypoint.stop) waypoint.turnInPlace = { headingDeg: tangentHeading(offset + 1) };
        });
      }
      if (path.headingMode === "targets") {
        path.targets = [
          { f: between(random, 0.1, 0.45), deg: between(random, -180, 180) },
          { f: between(random, 0.55, 0.9), deg: between(random, -180, 180) },
        ];
      }
      const rangeStart = between(random, 0, 0.55);
      const rangeEnd = between(random, rangeStart + 0.05, 1);
      path.ranges = [{
        anchor: "param",
        f0: rangeStart,
        f1: rangeEnd,
        maxVel: between(random, 0.4, path.constraints.maxVel),
        maxAccel: between(random, 0.3, path.constraints.maxAccel),
        maxDecel: between(random, 0.3, path.constraints.maxDecel),
        maxAngVel: between(random, 30, path.constraints.maxAngVel),
        maxAngAccel: between(random, 30, path.constraints.maxAngAccel),
        ...(project.robot.drive === "swerve" && caseIndex % 4 === 0
          ? { rotationPriority: "translation" as const }
          : {}),
      }];
      if (project.robot.drive === "swerve" && caseIndex % 8 === 0) {
        path.waypoints.at(-1)!.jiggle = {
          distanceM: 0.05,
          strokes: 2,
          startDeg: 90,
          stepDeg: 180,
          strokeTimeS: 0.3,
        };
      }

      const validation = validateProject(project);
      expect(validation.ok, `case ${caseIndex}: ${validation.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
      const context = `${plannerId} case ${caseIndex}`;
      const result = (() => {
        try {
          return getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 24 });
        } catch (error) {
          throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
      })();

      expect(result.samples.length, context).toBeGreaterThan(1);
      const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (path.ranges.some((range) => range.rotationPriority === "translation")) {
        expect(errors.every((diagnostic) => diagnostic.message.includes("Translation timing priority")), context).toBe(true);
      } else {
        expect(errors, context).toEqual([]);
      }
      expect(result.samples.every((sample, index) => sample.i === index), context).toBe(true);
      expect(result.samples.every((sample) => Object.values(sample).every(Number.isFinite)), context).toBe(true);
      expect(result.samples.every((sample) => sample.velocityMps >= -1e-9), context).toBe(true);
      expect(result.samples.every((sample) => sample.f >= -1e-9 && sample.f <= 1 + 1e-9), context).toBe(true);
      expectMonotonic(result.samples.map((sample) => sample.t));
      expectMonotonic(result.samples.map((sample) => sample.s), 1e-7);
      expectMonotonic(result.samples.map((sample) => sample.f), 1e-7);
      expect(result.samples[0].s, context).toBeCloseTo(0, 6);
      expect(result.samples[0].f, context).toBeCloseTo(0, 6);
      expect(result.samples.at(-1)!.t, context).toBeCloseTo(result.totalTimeS, 8);
      expect(result.samples.at(-1)!.s, context).toBeCloseTo(result.totalDistanceM, 3);
      expect(result.samples.at(-1)!.f, context).toBeCloseTo(1, 6);
      result.samples.slice(1).forEach((sample, index) => {
        const previous = result.samples[index];
        expect(Math.hypot(sample.x - previous.x, sample.y - previous.y), `${context} sample ${index + 1}`)
          .toBeLessThanOrEqual(sample.s - previous.s + 5e-4);
      });
      expectMonotonic(result.waypointSampleIndices ?? []);
      path.waypoints.forEach((waypoint, index) => {
        const sample = result.samples[result.waypointSampleIndices![index]];
        expect(Math.hypot(sample.x - waypoint.x, sample.y - waypoint.y), `${context} waypoint ${index}`).toBeLessThan(2e-4);
      });

      const analysis = analyzePath(project, path.id, { minimumClearanceM: 0, sampleLimit: 2_000 });
      const constraintFindings = analysis.findings.filter((finding) => finding.kind === "constraint");
      expect(constraintFindings, `${context} constraint analysis`).toEqual([]);
    }
  }, 30_000);
});
