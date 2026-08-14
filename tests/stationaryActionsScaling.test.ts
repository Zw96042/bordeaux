import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { profiledSplinePlanner } from "../src/shared/planners/profiledSpline";
import { applyStationaryActions } from "../src/shared/planners/stationaryActions";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { TrajectorySample } from "../src/shared/types";

function measuredLinearJerk(samples: readonly TrajectorySample[]): number {
  let maximum = 0;
  for (let index = 2; index < samples.length; index += 1) {
    const currentDt = samples[index].t - samples[index - 1].t;
    const previousDt = samples[index - 1].t - samples[index - 2].t;
    if (currentDt <= 1e-9 || previousDt <= 1e-9) continue;
    maximum = Math.max(
      maximum,
      Math.abs(samples[index].accelerationMps2 - samples[index - 1].accelerationMps2)
        / ((previousDt + currentDt) / 2),
    );
  }
  return maximum;
}

function mixedActionProject() {
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "tangent";
  path.waypoints = buildWaypoints([
    { x: 2, y: 2, theta: 0, thetaOn: true, segType: "line" },
    {
      x: 4, y: 2, theta: 90, thetaOn: true, stop: true, wait: 0.12,
      segType: "line", segmentHeadingMode: "manual",
      turnInPlace: { headingDeg: 90, direction: "counterclockwise" },
    },
    { x: 6, y: 3, theta: 90, thetaOn: true, stop: true, wait: 0.23, segType: "line" },
    {
      x: 8, y: 4, theta: 90, thetaOn: true, stop: true, wait: 0.17,
      turnInPlace: { headingDeg: 180, direction: "counterclockwise" },
      jiggle: { distanceM: 0.1, strokes: 3, startDeg: 0, stepDeg: 90, strokeTimeS: 0.4 },
    },
  ]);
  path.markers = [
    { id: "before", f: 0.2, name: "Before" },
    { id: "middle", f: 0.55, name: "Middle" },
    { id: "finish", f: 1, name: "Finish" },
  ];
  return project;
}

function manyWaitProject(waypointCount: number) {
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "manual";
  path.waypoints = buildWaypoints(Array.from({ length: waypointCount }, (_, index) => ({
    x: 0.7 + index * 0.001,
    y: 4,
    theta: 0,
    thetaOn: true,
    segType: "line" as const,
    stop: true,
    wait: 0.01,
  })));
  return project;
}

it("preserves the complete mixed stationary-action timeline", () => {
  const project = mixedActionProject();
  const result = getPlanner("profiledSpline").generate({ path: project.paths[0], robot: project.robot });
  const canonical = JSON.stringify(result, (_key, value) => (
    typeof value === "number" ? Number(value.toFixed(6)) : value
  ));
  const canonicalDigest = createHash("sha256").update(canonical).digest("hex");

  expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
  expect(result.samples).toHaveLength(579);
  expect(result.samples.every((sample, index) => sample.i === index)).toBe(true);
  expect(result.waypointSampleIndices).toEqual([0, 56, 209, 288]);
  expect(result.markers).toEqual([
    { id: "before", name: "Before", command: null, group: null, timeS: 0.6435, fraction: 0.2 },
    { id: "middle", name: "Middle", command: null, group: null, timeS: 2.796300000000001, fraction: 0.55 },
    { id: "finish", name: "Finish", command: null, group: null, timeS: 8.252900000000004, fraction: 1 },
  ]);
  expect(result.diagnostics).toEqual([
    { severity: "warning", path: "paths.NewPath.diagnostics[0]", message: "Velocity dip · 0.0 m/s" },
    { severity: "warning", path: "paths.NewPath.diagnostics[1]", message: "Velocity dip · 0.0 m/s" },
    { severity: "warning", path: "paths.NewPath.diagnostics[2]", message: "Velocity dip · 0.0 m/s" },
    { severity: "warning", path: "paths.NewPath.diagnostics[3]", message: "Rotation-limited · heading can’t keep up at speed" },
  ]);
  // Single-pass assembly evaluates t + (d1 + d2) instead of the quadratic
  // (t + d1) + d2 suffix rewrites. IEEE-754 can differ below 1e-15 seconds,
  // so time and derived angular velocity use canonical parity below controller precision.
  expect(canonicalDigest).toBe("ffec610d31f053d338ddc90ac150e6a11a954c0b22cdbd535e14e0373d2e1395");
});

it.each(["profiledSpline", "optimizedTrajectory"] as const)(
  "shifts a finish marker through coincident terminal-time actions in %s",
  (plannerId) => {
    for (const terminalWait of [0, 0.3]) {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: true, wait: 0.2 },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: terminalWait > 0, wait: terminalWait },
      ]);
      path.markers = [{ id: "finish", f: 1, name: "Finish" }];

      const result = getPlanner(plannerId).generate({ path, robot: project.robot });

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(result.markers[0].timeS).toBe(result.totalTimeS);
    }
  },
);

it.each(["profiledSpline", "optimizedTrajectory"] as const)(
  "generates jerk-limited jiggle strokes in %s",
  (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxJerk = 10;
    path.waypoints = buildWaypoints([
      { x: 4, y: 4, theta: 0, thetaOn: true, stop: true, segType: "line" },
      {
        x: 4,
        y: 4,
        theta: 0,
        thetaOn: true,
        stop: true,
        segType: "line",
        jiggle: { distanceM: 0.1, strokes: 2, startDeg: 90, stepDeg: 180, strokeTimeS: 0.4 },
      },
    ]);

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const arrival = result.waypointSampleIndices!.at(-1)!;
    const action = result.samples.slice(arrival);

    expect(action.length).toBeGreaterThan(3);
    expect(measuredLinearJerk(action)).toBeLessThanOrEqual(path.constraints.maxJerk + 1e-6);
    expect(result.diagnostics.some((issue) => issue.message.includes("Linear jerk"))).toBe(false);
    expect(result.totalTimeS).toBeGreaterThanOrEqual(2 * Math.cbrt(4.8));
  },
);

it.each(["profiledSpline", "optimizedTrajectory"] as const)(
  "keeps a coincident interior marker before its action in %s",
  (plannerId) => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: true, wait: 0.2 },
      { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line" },
      { x: 7, y: 2, theta: 0, thetaOn: true, segType: "line" },
    ]);
    path.markers = [{ id: "middle", f: 0.5, name: "Middle" }];
    const baselinePath = structuredClone(path);
    baselinePath.waypoints[1].wait = 0;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });
    const baseline = getPlanner(plannerId).generate({ path: baselinePath, robot: project.robot });

    expect(result.markers[0].timeS).toBe(baseline.markers[0].timeS);
    expect(result.totalTimeS).toBeGreaterThan(baseline.totalTimeS);
  },
);

const benchmark = process.env.BENCHMARK_STATIONARY_ACTIONS === "1" ? it : it.skip;

benchmark("scales across dense stationary-action paths", () => {
  const output: Record<number, { elapsedMs: number; samples: number }> = {};
  for (const waypointCount of [256, 512, 1_024, 4_096]) {
    const project = manyWaitProject(waypointCount);
    const input = { path: project.paths[0], robot: project.robot };
    const base = profiledSplinePlanner.generate(input);
    const started = performance.now();
    const result = applyStationaryActions(input.path, base, input.robot);
    output[waypointCount] = {
      elapsedMs: Number((performance.now() - started).toFixed(1)),
      samples: result.samples.length,
    };
  }
  console.log(`STATIONARY_ACTION_BENCHMARK=${JSON.stringify(output)}`);
  expect(Object.values(output).every(({ elapsedMs, samples }) => elapsedMs >= 0 && samples > 0)).toBe(true);
}, 120_000);
