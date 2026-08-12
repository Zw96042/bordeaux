import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { profiledSplinePlanner } from "../src/shared/planners/profiledSpline";
import { applyStationaryActions } from "../src/shared/planners/stationaryActions";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";

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
    typeof value === "number" ? Number(value.toFixed(12)) : value
  ));
  const canonicalDigest = createHash("sha256").update(canonical).digest("hex");
  const exactSampleDigest = createHash("sha256").update(JSON.stringify(result.samples.map((sample) => ({
    i: sample.i,
    s: sample.s,
    f: sample.f,
    x: sample.x,
    y: sample.y,
    headingRad: sample.headingRad,
    velocityMps: sample.velocityMps,
    accelerationMps2: sample.accelerationMps2,
    curvatureInvM: sample.curvatureInvM,
  })))).digest("hex");

  expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
  expect(result.samples).toHaveLength(579);
  expect(result.samples.every((sample, index) => sample.i === index)).toBe(true);
  expect(exactSampleDigest).toBe("fb15e7a5def6327262e55f22c29793327a0b4eb0a8eb540d175c5d186770828c");
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
  // so time and derived angular velocity use 12-decimal canonical parity.
  expect(canonicalDigest).toBe("1c62fcd83e002cd0f883926819ec591d9393f7d697c693eea944dc92a0def77e");
});

it("does not shift a finish marker for a coincident nonterminal action", () => {
  const project = createDemoProject();
  const path = project.paths[0];
  path.headingMode = "manual";
  path.waypoints = buildWaypoints([
    { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
    { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", stop: true, wait: 0.2 },
    { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line" },
  ]);
  path.markers = [{ id: "finish", f: 1, name: "Finish" }];

  const result = getPlanner("profiledSpline").generate({ path, robot: project.robot });

  expect(result.waypointSampleIndices).toEqual([0, 56, 128]);
  expect(result.markers[0].timeS).toBe(1.3605);
  expect(result.totalTimeS).toBe(1.5637000000000008);
});

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
