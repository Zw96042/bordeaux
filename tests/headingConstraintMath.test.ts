import { describe, expect, it } from "vitest";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { profiledSplineOptimizationSeed } from "../src/shared/planners/profiledSpline";
import { insertOptimizationBoundaries } from "../src/shared/planners/optimizationConstraints";
import { buildCanonicalPathState } from "../src/shared/planners/pathState";
import type { PlannerInput, TrajectorySample } from "../src/shared/types";
import { buildDenseValidationSamples } from "../src/shared/planners/optimizedTrajectory";
import { getPlanner } from "../src/shared/planners";
import { validateOptimizedTrajectory } from "../src/shared/planners/trajectoryValidation";
import turnFixture from "./fixtures/rotation-target-turn.json";

describe("heading constraint math", () => {
  it("preserves endpoint speed and heading despite integrated geometry drift", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 4, y: 0, theta: 90 },
    ]);
    const samples: TrajectorySample[] = [0, 2, 4].map((s, i) => ({
      i, s, f: s / 4, x: s + (i === 2 ? 0.00005 : 0), y: 0, t: i,
      headingRad: s / 4, velocityMps: i === 1 ? 2 : 0, accelerationMps2: 0,
      angularVelocityRadps: 0, curvatureInvM: 0,
    }));
    const dense = buildDenseValidationSamples({ path, robot: project.robot }, samples, 8);
    expect(dense.at(-1)?.velocityMps).toBe(0);
    expect(dense.at(-1)?.headingRad).toBe(samples.at(-1)?.headingRad);
  });

  it("does not manufacture angular acceleration while densifying a smooth heading curve", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 4, y: 0, theta: 90 },
    ]);
    const samples: TrajectorySample[] = Array.from({ length: 9 }, (_, i) => {
      const s = i / 2;
      return { i, s, f: s / 4, x: s, y: 0, t: s, headingRad: 0.1 * s * s,
        velocityMps: 1, accelerationMps2: 0, angularVelocityRadps: 0.2 * s, curvatureInvM: 0 };
    });
    for (const multiplier of [2, 4, 8]) {
      const dense = buildDenseValidationSamples({ path, robot: project.robot }, samples, 8, multiplier);
      for (let index = 1; index < dense.length; index += 1) {
        const before = dense[index - 1], after = dense[index];
        if (before.s < 1 || after.s > 3) continue;
        const acceleration = (after.angularVelocityRadps - before.angularVelocityRadps) / (after.t - before.t);
        expect(acceleration).toBeCloseTo(0.2, 5);
      }
    }
  });

  it("keeps the captured turn moving without relaxing its authored limits", () => {
    const input: PlannerInput = { ...structuredClone(turnFixture) as Pick<PlannerInput, "path" | "robot">, samplesPerSegment: 56 };
    const result = getPlanner("profiledSpline").generate(input);
    const minimum = Math.min(...result.samples.filter((sample) => sample.f > 0.48 && sample.f < 0.64)
      .map((sample) => sample.velocityMps / 0.3048));
    expect(minimum).toBeGreaterThan(4.5);
    expect(result.totalTimeS).toBeLessThan(5);
    expect(result.diagnostics.filter((issue) => issue.severity === "error")).toEqual([]);
    for (const multiplier of [2, 4, 8]) {
      const dense = buildDenseValidationSamples(input, result.samples,
        56 * 2 ** (result.optimization?.refinementPasses ?? 0), multiplier);
      expect(validateOptimizedTrajectory(input, dense, { angularKinematics: "sample" }).violations).toEqual([]);
    }
  });
  it("preserves an already exact heading law when inserting optimization boundaries", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "targets";
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 8, y: 0, theta: 100 },
    ]);
    path.targets = [{ f: 0.301, deg: 20 }, { f: 0.607, deg: 65 }];
    const input = { path, robot: project.robot, samplesPerSegment: 56 };
    const seed = profiledSplineOptimizationSeed(input);
    const samples = insertOptimizationBoundaries(input, seed.samples);
    for (const sample of seed.samples) {
      const actual = samples.find((candidate) => candidate.f === sample.f)!;
      expect(actual.headingRad).toBeCloseTo(sample.headingRad, 10);
    }
  });

  it("differentiates heading at the sample position on an uneven distance grid", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 4, y: 0, theta: 0 },
    ]);
    const samples: TrajectorySample[] = [0, 0.5, 0.99, 1, 1.5, 2, 3, 4].map((s, i) => ({
      i, s, f: s / 4, x: s, y: 0, t: s,
      headingRad: 0.1 * s * s, velocityMps: 1, accelerationMps2: 0,
      angularVelocityRadps: 0.2 * s, curvatureInvM: 0,
    }));
    const state = buildCanonicalPathState(path, samples);
    for (const point of state.points.slice(2, -2)) {
      expect(point.headingDerivativeRadPerM).toBeCloseTo(0.2 * point.s, 10);
      expect(point.headingSecondDerivativeRadPerM2).toBeCloseTo(0.2, 10);
    }
  });
});
