import { describe, expect, it } from "vitest";
// @ts-expect-error The production worker is an intentional JavaScript module.
import { applyFinalTrajectoryToPreview, processPathPreviewJob } from "../src/renderer/assets/path-preview-worker";

function derived(): any {
  return {
    sample: { length: 2, pts: [{ x: 0, y: 0, s: 0 }, { x: 1, y: 0, s: 1 }, { x: 2, y: 0, s: 2 }] },
    prof: { t: [0, 1, 2], v: [0, 1, 0], totalTime: 2, holds: [], turns: [], jiggles: [] },
    metrics: { head: [0, 0, 0], v: [0, 1, 0], accel: [0, 0, 0], omega: [0, 0, 0], curv: [0, 0, 0] },
    rev: false,
  };
}

function finalTrajectory(status = "optimal"): any {
  return {
    planner: status === "equivalent" ? "profiledSpline" : "optimizedTrajectory",
    totalTimeS: 1.8,
    totalDistanceM: 2,
    samples: [
      { i: 0, t: 0, s: 0, f: 0, x: 0, y: 0, headingRad: 0, velocityMps: 0, accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0 },
      { i: 1, t: 0.9, s: 1, f: 0.5, x: 1, y: 0, headingRad: 0, velocityMps: 1.2, accelerationMps2: 0.1, angularVelocityRadps: 0, curvatureInvM: 0 },
      { i: 2, t: 1.8, s: 2, f: 1, x: 2, y: 0, headingRad: 0, velocityMps: 0, accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0 },
    ],
    markers: [],
    diagnostics: [],
    optimization: { status, totalTimeS: 1.8, solveTimeMs: 12, fallback: false, constraintViolations: 0 },
  };
}

describe("path preview worker final optimization", () => {
  it("runs the fixed final optimizer only for an optimized final request", () => {
    const optimize = () => finalTrajectory();

    const result = processPathPreviewJob({
      id: 1, quality: "final", plannerId: "optimizedTrajectory", path: {}, robot: {}, perSegment: 56,
    }, derived, optimize);

    expect(result).toMatchObject({
      id: 1,
      quality: "final",
      value: {
        finalTrajectory: { totalTimeS: 1.8 },
        finalOptimization: { status: "optimal", totalTimeS: 1.8 },
        prof: { totalTime: 1.8, t: [0, 0.9, 1.8], v: [0, 1.2, 0] },
        metrics: { v: [0, 1.2, 0] },
      },
    });
  });

  it("projects an equivalent result through the same renderer-facing trajectory", () => {
    const projected = applyFinalTrajectoryToPreview(derived(), finalTrajectory("equivalent"));

    expect(projected.prof).toMatchObject({ totalTime: 1.8, t: [0, 0.9, 1.8] });
    expect(projected.finalOptimization.status).toBe("equivalent");
  });

  it("keeps terminal stationary actions inside the accepted final duration", () => {
    const interactive = derived();
    interactive.prof.t = [0, 1, 2];
    interactive.prof.totalTime = 3;
    interactive.prof.turns = [{ idx: 2, t0: 2, t1: 2.4, start: 0, delta: Math.PI / 2 }];
    interactive.prof.holds = [{ idx: 2, t0: 2.4, t1: 3 }];
    const accepted = finalTrajectory();
    accepted.totalTimeS = 2.6;
    accepted.optimization.totalTimeS = 2.6;
    accepted.stationaryActions = [
      { kind: "turn", waypointIndex: 2, fraction: 1, startTimeS: 1.8, endTimeS: 2.1 },
      { kind: "wait", waypointIndex: 2, fraction: 1, startTimeS: 2.1, endTimeS: 2.6 },
    ];
    accepted.samples = [
      accepted.samples[0],
      { ...accepted.samples[1], t: 0.8 },
      { ...accepted.samples[2], t: 1.8, headingRad: 0 },
      { ...accepted.samples[2], i: 3, t: 2.1, headingRad: Math.PI / 2 },
      { ...accepted.samples[2], i: 4, t: 2.6, headingRad: Math.PI / 2 },
    ];

    const projected = applyFinalTrajectoryToPreview(interactive, accepted);

    expect(projected.prof.t).toEqual([0, 0.8, 1.8]);
    expect(projected.prof.turns).toEqual([{ idx: 2, t0: 1.8, t1: 2.1, start: 0, delta: Math.PI / 2 }]);
    expect(projected.prof.holds).toEqual([{ idx: 2, t0: 2.1, t1: 2.6 }]);
    expect(projected.prof.totalTime).toBe(2.6);
  });

  it("ignores non-monotonic interior jiggle samples when projecting later geometry", () => {
    const interactive = derived();
    interactive.sample.length = 4;
    interactive.sample.pts = [
      { x: 0, y: 0, s: 0 },
      { x: 1, y: 0, s: 1 },
      { x: 2, y: 0, s: 2 },
      { x: 4, y: 0, s: 4 },
    ];
    interactive.prof = {
      t: [0, 1, 2, 4], v: [0, 1, 1, 0], totalTime: 4.5, holds: [], turns: [],
      jiggles: [{ idx: 1, t0: 1, t1: 1.5, strokeDuration: 0.5, config: { strokes: 1 } }],
    };
    interactive.metrics = {
      head: [0, 0, 0, 0], v: [0, 1, 1, 0], accel: [0, 0, 0, 0], omega: [0, 0, 0, 0], curv: [0, 0, 0, 0],
    };
    const accepted = finalTrajectory();
    accepted.totalTimeS = 3.5;
    accepted.optimization.totalTimeS = 3.5;
    accepted.stationaryActions = [
      { kind: "jiggle", waypointIndex: 1, fraction: 0.25, startTimeS: 0.7, endTimeS: 1.1, strokeDurationS: 0.4 },
    ];
    accepted.samples = [
      { ...accepted.samples[0], s: 0, f: 0, x: 0, t: 0 },
      { ...accepted.samples[1], s: 1, f: 0.25, x: 1, t: 0.7 },
      { ...accepted.samples[1], i: 2, s: 1.2, f: 1, x: 1.2, t: 0.95 },
      { ...accepted.samples[1], i: 3, s: 1.4, f: 1, x: 1, t: 1.2 },
      { ...accepted.samples[1], i: 4, s: 2, f: 0.5, x: 2, t: 2 },
      { ...accepted.samples[1], i: 5, s: 4, f: 1, x: 4, t: 3.5, velocityMps: 0 },
    ];

    const projected = applyFinalTrajectoryToPreview(interactive, accepted);

    expect(projected.prof.t).toEqual([0, 0.7, 2, 3.5]);
    expect(projected.prof.jiggles[0]).toMatchObject({ t0: 0.7, t1: 1.1, strokeDuration: 0.4 });
    expect(projected.prof.totalTime).toBe(3.5);
  });

  it("returns the optimizer fallback reason without replacing the interactive value", () => {
    const result = processPathPreviewJob({
      id: 2, quality: "final", plannerId: "optimizedTrajectory", path: {}, robot: {}, perSegment: 56,
    }, () => ({ interactive: true }), () => ({
      optimization: { fallback: true, fallbackReason: "candidate failed dense validation" },
    }));

    expect(result).toMatchObject({
      id: 2,
      finalFallbackReason: "candidate failed dense validation",
    });
    expect(result).not.toHaveProperty("value");
  });
});
