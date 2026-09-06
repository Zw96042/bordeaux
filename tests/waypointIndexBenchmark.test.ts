import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { analyzePath } from "../src/shared/agent/pathAnalysis";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { getPlanner } from "../src/shared/planners";
import { profiledSplinePlanner } from "../src/shared/planners/profiledSpline";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog } from "../src/shared/types";

const benchmark = process.env.BENCHMARK_WAYPOINT_INDEX === "1" ? it : it.skip;

function fixture(wait = false) {
  const project = createDemoProject();
  project.plannerId = "profiledSpline";
  const path = project.paths[0];
  path.id = "benchmark_path";
  project.editor = { ...project.editor, activePathId: path.id };
  project.routines[0].id = "benchmark_routine";
  project.activeRoutineId = project.routines[0].id;
  path.headingMode = "manual";
  path.waypoints = buildWaypoints(Array.from({ length: 600 }, (_, index) => ({
    x: 0.7 + index / 599 * 16,
    y: 4 + Math.sin(index * 0.07) * 0.2,
    theta: index * 17 % 360,
    thetaOn: true,
    segType: "line" as const,
  })));
  if (wait) {
    path.waypoints.at(-1)!.stop = true;
    path.waypoints.at(-1)!.wait = 0.2;
  }
  return project;
}

function turnFixture() {
  const project = fixture();
  const path = project.paths[0];
  path.waypoints = buildWaypoints(Array.from({ length: 600 }, (_, index) => ({
    x: 0.7 + index / 599 * 16,
    y: 4,
    theta: 0,
    thetaOn: true,
    stop: true,
    turnInPlace: { headingDeg: 0, direction: "shortest" as const },
    segType: "line" as const,
  })));
  return project;
}

const catalog: JavaCommandCatalog = {
  projectName: "BenchmarkRobot",
  sourceFileCount: 1,
  scannedAt: "2026-08-12T00:00:00.000Z",
  source: "generated",
  runtimeCommandCount: 0,
  generatedSchemaVersion: "1.0",
  catalogId: "benchmark-robot",
  supportVersion: "0.1.0",
  catalogHash: `sha256:${"a".repeat(64)}`,
  authoritative: true,
  warnings: [],
  commands: [],
};

function digest(value: unknown): string {
  const serialized = JSON.stringify(value, (key, item) => key === "waypointSampleIndices" ? undefined : item);
  return createHash("sha256").update(serialized ?? "undefined").digest("hex");
}

benchmark("indexes 600 ordered waypoint arrivals and heading anchors", () => {
  const project = fixture();
  const waitProject = fixture(true);
  const turnProject = turnFixture();
  const operations = {
    plan: () => getPlanner("profiledSpline").generate({ path: project.paths[0], robot: project.robot }),
    wait: () => getPlanner("profiledSpline").generate({ path: waitProject.paths[0], robot: waitProject.robot }),
    analysis: () => analyzePath(project, project.paths[0].id),
    java: () => buildJavaTrajectory(project, catalog),
    turns: () => profiledSplinePlanner.generate({ path: turnProject.paths[0], robot: turnProject.robot }),
  };
  const output: Record<string, { samplesMs: number[]; digest: string }> = {};
  for (const [name, operation] of Object.entries(operations)) {
    operation();
    const samplesMs: number[] = [];
    let result: unknown;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      result = operation();
      samplesMs.push(Number((performance.now() - started).toFixed(1)));
    }
    output[name] = { samplesMs, digest: digest(result) };
  }
  expect(Object.values(output).every((entry) => entry.samplesMs.every(Number.isFinite))).toBe(true);
  expect(Object.fromEntries(Object.entries(output).map(([name, entry]) => [name, entry.digest]))).toEqual({
    plan: "e02433cba19cbf3dff443d4d8d09b337947bd81b02d5be55b2f27328b78b84f6",
    wait: "8caae49ba5e6ace94057c513b84809a0769b3c03fef53c13d362d0c5e6647367",
    analysis: "2597f248ea0908902496331e16151a285b4629557d2f85b8d4600e029f537048",
    java: "9b448b8e5afbcfa30a9c74d16d6066e6ee67c4f7f2dbb47edd5ee638305dd8b7",
    turns: "bebd661950a3b4cb7474d33b9a33c5ac8b8e74fad5740c525b44a40b80eded50",
  });
  console.log(JSON.stringify(output));
}, 120_000);
