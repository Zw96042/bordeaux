import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FixedGeometryCorpus } from "../src/electron/benchmark/fixedGeometry";
import { getPlanner } from "../src/shared/planners";
import { optimizeFixedGeometryFinal } from "../src/shared/planners/fixedGeometryFinal";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import { createDemoProject } from "../src/shared/project/defaults";

const corpusDirectory = join(dirname(fileURLToPath(import.meta.url)), "../benchmarks/planner-corpus/v1");
const corpus = FixedGeometryCorpus.loadV1(corpusDirectory);
const project = decodeProjectFile(readFileSync(join(corpusDirectory, "corpus.bordeaux.json"), "utf8")).project;

describe("fixed-geometry final optimization", () => {
  it("returns a valid improvement or honest equivalent for every frozen swerve case", () => {
    for (const fixture of corpus.cases) {
      const path = project.paths.find((candidate) => candidate.id === fixture.pathId)!;
      const input = { path, robot: project.robot, samplesPerSegment: 56 };
      const interactive = getPlanner("profiledSpline").generate(input);
      const final = optimizeFixedGeometryFinal(input);
      const validation = corpus.validate(fixture.id, final);

      expect(validation.valid, `${fixture.id}: ${validation.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
      expect(final.totalTimeS).toBeLessThanOrEqual(interactive.totalTimeS + 0.0001);
      expect(final.optimization).toMatchObject({
        status: expect.stringMatching(/^(optimal|feasible|equivalent)$/),
        constraintViolations: 0,
      });
      expect(final.samples[0].x).toBeCloseTo(interactive.samples[0].x, 5);
      expect(final.samples[0].y).toBeCloseTo(interactive.samples[0].y, 5);
      expect(final.samples[0].headingRad).toBeCloseTo(interactive.samples[0].headingRad, 5);
      expect(final.samples[0].velocityMps).toBeCloseTo(interactive.samples[0].velocityMps, 5);
      expect(final.samples.at(-1)!.x).toBeCloseTo(interactive.samples.at(-1)!.x, 5);
      expect(final.samples.at(-1)!.y).toBeCloseTo(interactive.samples.at(-1)!.y, 5);
      expect(final.samples.at(-1)!.headingRad).toBeCloseTo(interactive.samples.at(-1)!.headingRad, 5);
      expect(final.samples.at(-1)!.velocityMps).toBeCloseTo(interactive.samples.at(-1)!.velocityMps, 5);
    }
  });

  it("keeps the interactive result and records why an invalid optimization was rejected", () => {
    const demo = createDemoProject();
    demo.paths[0].constraints.maxJerk = 4;
    const input = { path: demo.paths[0], robot: demo.robot };
    const interactive = getPlanner("profiledSpline").generate(input);

    const final = optimizeFixedGeometryFinal(input);

    expect(final.samples).toEqual(interactive.samples);
    expect(final.optimization).toMatchObject({
      plannerUsed: "profiledSpline",
      status: "internal-error",
      fallback: true,
      fallbackReason: expect.stringContaining("translational jerk"),
    });
      tangentRad: 0, tangentX: 1, tangentY: 0, normalX: 0, normalY: 1,
      curvatureInvM: 0, headingRad: 0,
      headingDerivativeRadPerM: 0, headingSecondDerivativeRadPerM2: 0,
      segmentIndex: 0, segmentFraction: 0, stop: false,
    };

    const translationOnly = evaluateDrivetrainForces(
      point,
      demo.robot,
      0,
      limits.tractionAccelMps2 * 0.8,
      0,
      0,
    );
    const yawOnly = evaluateDrivetrainForces(
      point,
      demo.robot,
      0,
      0,
      0,
      angularAccelerationLimit * 0.8,
    );
    const combined = evaluateDrivetrainForces(
      point,
      demo.robot,
      0,
      limits.tractionAccelMps2 * 0.8,
      0,
      angularAccelerationLimit * 0.8,
    );
    const torqueLimited = evaluateDrivetrainForces(
      point,
      {
        ...demo.robot,
        driveModel: { ...demo.robot.driveModel, motorMaxTorqueNm: 0.2 },
      },
      0,
      3,
      0,
      0,
    );

    expect(translationOnly.every((module) => module.requiredForceN < module.tractionForceLimitN)).toBe(true);
    expect(yawOnly.every((module) => module.requiredForceN < module.tractionForceLimitN)).toBe(true);
    expect(combined.some((module) => module.requiredForceN > module.tractionForceLimitN)).toBe(true);
    expect(torqueLimited.some((module) => module.requiredMotorForceN > module.motorForceLimitN)).toBe(true);
  });

  it("densely optimizes translation priority without a physical drive model", () => {
    const demo = createDemoProject();
    const path = demo.paths[0];
    path.headingMode = "manual";
    path.constraints.maxVel = 0.5;
    path.constraints.maxAccel = 1;
    path.constraints.maxDecel = 1;
    path.waypoints = buildWaypoints([
      { x: 2, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 6, y: 2, theta: 0, thetaOn: true },
    ]);
    path.ranges = [{
      anchor: "param",
      f0: 0,
      f1: 1,
      maxVel: 0.5,
      maxAccel: 1,
      maxDecel: 1,
      maxAngVel: path.constraints.maxAngVel,
      maxAngAccel: path.constraints.maxAngAccel,
      rotationPriority: "translation",
    }];

    const result = getPlanner("optimizedTrajectory").generate({ path, robot: demo.robot, samplesPerSegment: 56 });
    expect(result.optimization).toMatchObject({
      status: expect.stringMatching(/^(optimal|feasible|equivalent)$/),
      constraintViolations: 0,
      fallback: false,
    });
    expect(result.optimization!.validatedPoints).toBeGreaterThan(result.samples.length);
  });

  it("recovers translation timing without changing moving endpoint velocities", () => {
    const demo = createDemoProject();
    demo.robot.driveModel = {
      motorId: "custom",
      motorFreeRpm: 6784,
      motorMaxTorqueNm: 3.6,
      motorCount: 4,
      gearRatio: 6.75,
      wheelDiameterM: 0.1016,
      massKg: 54,
      moiKgM2: 6.3504,
      wheelbaseM: 0.66,
      trackwidthM: 0.66,
      wheelFrictionCoefficient: 1.2,
    };
    const path = demo.paths[0];
    path.headingMode = "manual";
    path.startVel = 1;
    path.goalVel = 1;
    path.constraints = {
      ...path.constraints,
      maxVel: 4,
      maxAccel: 5,
      maxDecel: 5,
      maxAngVel: 60,
      maxAngAccel: 120,
      maxAngDecel: 120,
    };
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 8, y: 2, theta: 180, thetaOn: true },
    ]);
    path.ranges = [{
      anchor: "param",
      f0: 0.05,
      f1: 0.95,
      maxVel: 4,
      maxAccel: 5,
      maxDecel: 5,
      maxAngVel: 60,
      maxAngAccel: 120,
      rotationPriority: "translation",
    }];

    const result = getPlanner("optimizedTrajectory").generate({ path, robot: demo.robot, samplesPerSegment: 56 });
    expect(result.optimization).toMatchObject({
      status: expect.stringMatching(/^(optimal|feasible|equivalent)$/),
      constraintViolations: 0,
      fallback: false,
    });
    expect(result.samples[0].velocityMps).toBe(1);
    expect(result.samples.at(-1)!.velocityMps).toBe(1);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ severity: "error" }));
  });
});
