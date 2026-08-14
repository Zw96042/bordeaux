import { describe, expect, it } from "vitest";
import { buildBdxExport } from "../src/shared/export/bdx";
import { buildJavaTrajectory } from "../src/shared/export/javaTrajectory";
import { getPlanner } from "../src/shared/planners";
import { addJerkDiagnostics } from "../src/shared/planners/jerkDiagnostics";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { JavaCommandCatalog, PlannerResult, TrajectoryPlannerId, TrajectorySample } from "../src/shared/types";

const PLANNERS: TrajectoryPlannerId[] = ["profiledSpline", "optimizedTrajectory"];

function measuredLinearJerk(samples: readonly TrajectorySample[]): number {
  let linear = 0;
  for (let index = 2; index < samples.length; index += 1) {
    const sample = samples[index];
    const previous = samples[index - 1];
    const dt = sample.t - previous.t;
    const previousDt = previous.t - samples[index - 2].t;
    if (dt <= 1e-9 || previousDt <= 1e-9) continue;
    linear = Math.max(linear, Math.abs(sample.accelerationMps2 - previous.accelerationMps2) / ((previousDt + dt) / 2));
  }
  return linear;
}

function movingProject() {
  const project = createDemoProject();
  const path = project.paths[0];
  path.constraints = {
    ...path.constraints,
    maxVel: 4,
    maxAccel: 10,
    maxDecel: 10,
    maxAngVel: 360,
    maxAngAccel: 720,
  };
  path.waypoints = buildWaypoints([
    { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
    { x: 8, y: 2, theta: 180, thetaOn: true },
  ]);
  return project;
}

function generatedCatalog(): JavaCommandCatalog {
  return {
    projectName: "CompetitionRobot",
    sourceFileCount: 1,
    scannedAt: "2026-08-12T00:00:00.000Z",
    source: "generated",
    runtimeCommandCount: 0,
    generatedSchemaVersion: "1.0",
    catalogId: "competition-robot",
    supportVersion: "0.2.0-beta.3",
    catalogHash: `sha256:${"a".repeat(64)}`,
    authoritative: true,
    warnings: [],
    commands: [],
  };
}

describe("final trajectory jerk diagnostics", () => {
  it.each(PLANNERS)("reports moving linear jerk violations in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.constraints.maxJerk = 0.1;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(measuredLinearJerk(result.samples)).toBeGreaterThan(path.constraints.maxJerk);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      path: `paths.${path.name}.constraints.maxJerk`,
      message: expect.stringContaining("Linear jerk"),
    }));
    if (result.optimization) expect(result.optimization.constraintViolations).toBeGreaterThan(0);
  });

  it.each(PLANNERS)("reports moving angular jerk violations in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxAngJerk = 1;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      path: `paths.${path.name}.constraints.maxAngJerk`,
      message: expect.stringContaining("Angular jerk"),
    }));
    if (result.optimization) expect(result.optimization.constraintViolations).toBeGreaterThan(0);
  });

  it.each(PLANNERS)("preserves jerk-constrained stationary turns in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints[1].theta = 0;
    path.waypoints[1].stop = true;
    path.waypoints[1].turnInPlace = { headingDeg: 90, direction: "counterclockwise" };
    path.constraints.maxAngJerk = 120;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(result.diagnostics.some((issue) => issue.message.includes("Angular jerk"))).toBe(false);
    expect(result.samples.at(-1)!.headingRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it("measures angular jerk between interval midpoints on nonuniform samples", () => {
    const project = movingProject();
    const path = project.paths[0];
    path.constraints.maxAngJerk = 65;
    const sample = (i: number, t: number, angularVelocityRadps: number): TrajectorySample => ({
      i, t, angularVelocityRadps,
      s: 0, f: i / 2, x: 0, y: 0, headingRad: 0,
      velocityMps: 0, accelerationMps2: 0, curvatureInvM: 0,
    });
    const result = addJerkDiagnostics(path, {
      planner: "profiledSpline",
      totalTimeS: 3,
      totalDistanceM: 0,
      samples: [sample(0, 0, 0), sample(1, 1, 0), sample(2, 3, 4)],
      markers: [],
      diagnostics: [],
    } satisfies PlannerResult);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      path: `paths.${path.name}.constraints.maxAngJerk`,
      message: "Angular jerk reaches 76.394 °/s³, above the maxAngJerk limit of 65.000 °/s³",
    });
  });

  it("measures linear jerk between interval midpoints on nonuniform samples", () => {
    const project = movingProject();
    const path = project.paths[0];
    path.constraints.maxJerk = 2.5;
    const sample = (i: number, t: number, accelerationMps2: number): TrajectorySample => ({
      i, t, accelerationMps2,
      s: 0, f: i / 2, x: 0, y: 0, headingRad: 0,
      velocityMps: 0, angularVelocityRadps: 0, curvatureInvM: 0,
    });
    const result = addJerkDiagnostics(path, {
      planner: "profiledSpline",
      totalTimeS: 3,
      totalDistanceM: 0,
      samples: [sample(0, 0, 0), sample(1, 1, 0), sample(2, 3, 4)],
      markers: [],
      diagnostics: [],
    } satisfies PlannerResult);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      path: `paths.${path.name}.constraints.maxJerk`,
      message: "Linear jerk reaches 2.667 m/s³, above the maxJerk limit of 2.500 m/s³",
    });
  });

  it.each(PLANNERS)("blocks native and Java export when %s violates maxJerk", (plannerId) => {
    const project = movingProject();
    project.plannerId = plannerId;
    project.paths[0].headingMode = "tangent";
    project.paths[0].constraints.maxJerk = 0.1;

    expect(() => buildBdxExport(project)).toThrow(/Linear jerk/);
    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow(/Linear jerk/);
  });

  it.each(PLANNERS)("blocks native and Java export when %s violates maxAngJerk", (plannerId) => {
    const project = movingProject();
    project.plannerId = plannerId;
    project.paths[0].headingMode = "manual";
    project.paths[0].constraints.maxAngJerk = 1;

    expect(() => buildBdxExport(project)).toThrow(/Angular jerk/);
    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow(/Angular jerk/);
  });
});
