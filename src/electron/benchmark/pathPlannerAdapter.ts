import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PM } from "../../shared/math/pm";
import { activeRanges, effectiveRanges } from "../../shared/planners/rotationPriority";
import { decodeProjectFile } from "../../shared/project/fileFormat";
import type { BordeauxProject, PathDoc, TrajectorySample } from "../../shared/types";
import { CorridorCorpus } from "./corridor";
import { FixedGeometryCorpus, normalizeTrajectoryCandidate, type NormalizedTrajectory } from "./fixedGeometry";

export const PATHPLANNER_VERSION = "2026.1.2";
export const PATHPLANNER_WPILIB_VERSION = "2026.1.1";
export const PATHPLANNER_JAVA_VERSION = "17";
export const PATHPLANNER_ADAPTER_VERSION = "1.0.0" as const;

type BenchmarkClass = "fixed-geometry" | "corridor";

type PathPlannerPoint = {
  x: number;
  y: number;
  headingRad: number;
  maxVelocityMps: number;
  maxAccelerationMps2: number;
  maxAngularVelocityRadps: number;
  maxAngularAccelerationRadps2: number;
};

export type PathPlannerRequest = {
  schemaVersion: "bordeaux-pathplanner-request/1.0";
  fixture: { benchmarkClass: "fixed-geometry"; fixtureId: string; pathId: string; deterministicSeed: number };
  tool: {
    name: "PathPlannerLib";
    version: typeof PATHPLANNER_VERSION;
    wpilibVersion: typeof PATHPLANNER_WPILIB_VERSION;
    javaVersion: typeof PATHPLANNER_JAVA_VERSION;
  };
  mapping: {
    geometry: string;
    heading: string;
    centripetal: string;
    robotDynamics: string;
    unsupportedConcepts: string[];
  };
  robot: {
    massKg: number;
    momentOfInertiaKgM2: number;
    bumperWidthM: number;
    bumperLengthM: number;
    wheelRadiusM: number;
    moduleMaxSpeedMps: number;
    wheelCoefficientOfFriction: number;
    driveMotor: "NEO";
    driveGearing: number;
    driveCurrentLimitA: number;
  };
  path: {
    startVelocityMps: number;
    goalVelocityMps: number;
    startTravelHeadingRad: number;
    startRobotHeadingRad: number;
    goalRobotHeadingRad: number;
    rotationTargetStride: number;
    points: PathPlannerPoint[];
  };
};

export type PathPlannerPreparation =
  | {
    supported: true;
    benchmarkClass: "fixed-geometry";
    fixtureId: string;
    request: PathPlannerRequest;
    requestContents: string;
    requestSha256: string;
  }
  | {
    supported: false;
    benchmarkClass: BenchmarkClass;
    fixtureId: string;
    code: string;
    reason: string;
  };

export type PathPlannerProcessCapture = {
  invocation: PathPlannerInvocation;
  exitCode: number;
  stdout: string;
  stderr: string;
  rawOutput: string | null;
};

export type PathPlannerInvocation = {
  executable: string;
  arguments: string[];
  workingDirectory: string;
};

export type PathPlannerAdapterResult = {
  schemaVersion: "bordeaux-pathplanner-capture/1.0";
  adapterVersion: typeof PATHPLANNER_ADAPTER_VERSION;
  requestSha256: string;
  invocation: {
    executable: string;
    arguments: string[];
    workingDirectory: string;
  };
  process: { exitCode: number; stdout: string; stderr: string };
  rawOutput: string | null;
  normalized: NormalizedTrajectory | null;
  events: Array<{ id: string; timeS: number }>;
  outcome: "generated" | "failed";
  failure?: string;
};

type PathPlannerRawState = {
  timeSeconds: number;
  x: number;
  y: number;
  headingRad: number;
  velocityXMps: number;
  velocityYMps: number;
  angularVelocityRadps: number;
};

type PathPlannerRawOutput = {
  schemaVersion: "bordeaux-pathplanner-raw/1.0";
  toolVersion: string;
  wpilibVersion: string;
  javaRuntimeVersion: string;
  states: PathPlannerRawState[];
  events: Array<{ id: string; timeS: number }>;
};

function digest(contents: string): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fixtureProject(directory: string): BordeauxProject {
  return decodeProjectFile(readFileSync(join(directory, "corpus.bordeaux.json"), "utf8")).project;
}

export function pathPlannerUnsupportedConcept(path: PathDoc): string | null {
  if (path.waypoints.some((waypoint) => waypoint.stop || (waypoint.wait ?? 0) > 0)) {
    return "PathPlannerLib trajectory generation does not represent Bordeaux waypoint stops or waits.";
  }
  if (Math.abs(path.constraints.maxAccel - path.constraints.maxDecel) > 1e-9) {
    return "PathPlannerLib exposes one linear acceleration magnitude, not separate acceleration and deceleration limits.";
  }
  if ((path.constraints.maxJerk ?? 0) > 0 || (path.constraints.maxAngJerk ?? 0) > 0) {
    return "PathPlannerLib does not expose the authored Bordeaux jerk limits used by this fixture.";
  }
  if (Math.abs(path.constraints.maxAngAccel - (path.constraints.maxAngDecel ?? path.constraints.maxAngAccel)) > 1e-9) {
    return "PathPlannerLib exposes one angular acceleration magnitude, not separate acceleration and deceleration limits.";
  }
  if (path.ranges.some((range) => Math.abs(range.maxAccel - (range.maxDecel ?? range.maxAccel)) > 1e-9)) {
    return "PathPlannerLib exposes one acceleration magnitude per constraint range, not separate acceleration and deceleration limits.";
  }
  if (path.ranges.some((range) => range.rotationPriority !== undefined)) {
    return "PathPlannerLib does not expose Bordeaux range-level heading-versus-translation rotation priority.";
  }
  return null;
}

export function pathPlannerInvocation(
  repositoryRoot: string,
  requestPath: string,
  rawOutputPath: string,
): PathPlannerInvocation {
  const root = resolve(repositoryRoot);
  return {
    executable: resolve(root, "java/gradlew"),
    arguments: [
      "--no-daemon",
      "-p",
      resolve(root, "benchmarks/adapters/pathplanner"),
      "run",
      `--args=${resolve(requestPath)} ${resolve(rawOutputPath)}`,
    ],
    workingDirectory: root,
  };
}

function fixedRequest(
  fixtureId: string,
  deterministicSeed: number,
  project: BordeauxProject,
  path: PathDoc,
): PathPlannerRequest {
  const derived = PM.derivePath(path, project.robot, 96, { skipStationaryActions: true });
  const points = derived.sample.pts as Array<{ x: number; y: number; s: number }>;
  const headings = derived.metrics.head as number[];
  const totalDistanceM = points.at(-1)?.s ?? 0;
  const samples: TrajectorySample[] = points.map((point, index) => ({
    ...point,
    i: index,
    t: 0,
    f: point.s / Math.max(totalDistanceM, 1e-9),
    headingRad: headings[index] ?? 0,
    velocityMps: 0,
    accelerationMps2: 0,
    angularVelocityRadps: 0,
    curvatureInvM: 0,
  }));
  const ranges = effectiveRanges(path, samples, totalDistanceM);
  return {
    schemaVersion: "bordeaux-pathplanner-request/1.0",
    fixture: { benchmarkClass: "fixed-geometry", fixtureId, pathId: path.id, deterministicSeed },
    tool: {
      name: "PathPlannerLib",
      version: PATHPLANNER_VERSION,
      wpilibVersion: PATHPLANNER_WPILIB_VERSION,
      javaVersion: PATHPLANNER_JAVA_VERSION,
    },
    mapping: {
      geometry: "Bordeaux authored geometry sampled at 96 points per segment and passed as PathPoint positions; no Bordeaux timing is supplied.",
      heading: "The authored holonomic heading law is supplied as a RotationTarget on every PathPoint after the start; the start heading is passed as the initial rotation.",
      centripetal: "The path maxCentripetalAccel is mapped to wheelCoefficientOfFriction=maxCentripetalAccel/9.80665.",
      robotDynamics: "Bordeaux dimensions and max speed are preserved; mass, MOI, wheel, NEO gearing, and current are frozen adapter assumptions.",
      unsupportedConcepts: [
        "PathPlanner GUI genetic geometry optimization is not a headless PathPlannerLib API and is not invoked.",
        "Bordeaux commands and routines are outside this trajectory-only benchmark adapter.",
      ],
    },
    robot: {
      massKg: 56,
      momentOfInertiaKgM2: 6,
      bumperWidthM: project.robot.w,
      bumperLengthM: project.robot.l,
      wheelRadiusM: 0.0508,
      moduleMaxSpeedMps: project.robot.maxSpeed,
      wheelCoefficientOfFriction: (path.constraints.maxCentripetalAccel ?? path.constraints.maxAccel) / 9.80665,
      driveMotor: "NEO",
      driveGearing: 6.75,
      driveCurrentLimitA: 60,
    },
    path: {
      startVelocityMps: path.startVel,
      goalVelocityMps: path.goalVel,
      startTravelHeadingRad: (derived.sample.pts[0] as { heading?: number } | undefined)?.heading ?? 0,
      startRobotHeadingRad: headings[0] ?? 0,
      goalRobotHeadingRad: headings.at(-1) ?? 0,
      rotationTargetStride: 1,
      points: samples.map((point) => {
        const active = activeRanges(ranges, point.f);
        return {
          x: point.x,
          y: point.y,
          headingRad: point.headingRad,
          maxVelocityMps: Math.min(project.robot.maxSpeed, path.constraints.maxVel, ...active.map((range) => range.maxVel)),
          maxAccelerationMps2: Math.min(path.constraints.maxAccel, ...active.map((range) => range.maxAccel)),
          maxAngularVelocityRadps: Math.min(path.constraints.maxAngVel, ...active.map((range) => range.maxAngVel)) * Math.PI / 180,
          maxAngularAccelerationRadps2: Math.min(path.constraints.maxAngAccel, ...active.map((range) => range.maxAngAccel)) * Math.PI / 180,
        };
      }),
    },
  };
}

export function preparePathPlannerFixture(
  directory: string,
  benchmarkClass: BenchmarkClass,
  fixtureId: string,
): PathPlannerPreparation {
  const project = fixtureProject(directory);
  if (benchmarkClass === "corridor") {
    const fixture = CorridorCorpus.loadV1(directory).cases.find((value) => value.id === fixtureId);
    if (!fixture) return { supported: false, benchmarkClass, fixtureId, code: "fixture:identity", reason: "Fixture is not in the pinned corridor corpus." };
    return {
      supported: false,
      benchmarkClass,
      fixtureId,
      code: "pathplanner:headless-corridor-optimization-unavailable",
      reason: "PathPlanner v2026.1.2 exposes corridor geometry optimization only through its GUI, so the reproducible headless adapter does not claim a corridor result.",
    };
  }
  const fixture = FixedGeometryCorpus.loadV1(directory).cases.find((value) => value.id === fixtureId);
  if (!fixture) return { supported: false, benchmarkClass, fixtureId, code: "fixture:identity", reason: "Fixture is not in the pinned fixed-geometry corpus." };
  const path = project.paths.find((value) => value.id === fixture.pathId)!;
  const unsupported = pathPlannerUnsupportedConcept(path);
  if (unsupported) return { supported: false, benchmarkClass, fixtureId, code: "pathplanner:unsupported-concept", reason: unsupported };
  const request = fixedRequest(fixture.id, fixture.deterministicSeed, project, path);
  const requestContents = `${JSON.stringify(request, null, 2)}\n`;
  return {
    supported: true,
    benchmarkClass,
    fixtureId,
    request,
    requestContents,
    requestSha256: digest(requestContents),
  };
}

function parseRawOutput(contents: string): { normalized: NormalizedTrajectory; events: Array<{ id: string; timeS: number }> } {
  const raw = JSON.parse(contents) as PathPlannerRawOutput;
  if (raw.schemaVersion !== "bordeaux-pathplanner-raw/1.0"
    || raw.toolVersion !== PATHPLANNER_VERSION
    || raw.wpilibVersion !== PATHPLANNER_WPILIB_VERSION
    || typeof raw.javaRuntimeVersion !== "string"
    || !raw.javaRuntimeVersion.startsWith(`${PATHPLANNER_JAVA_VERSION}.`)
    || !Array.isArray(raw.states) || !Array.isArray(raw.events)) {
    throw new Error("PathPlanner raw output does not match the pinned adapter contract.");
  }
  const samples = raw.states.map((state, index, states) => {
    if (![state.timeSeconds, state.x, state.y, state.headingRad, state.velocityXMps, state.velocityYMps, state.angularVelocityRadps].every(finite)) {
      throw new Error("PathPlanner raw output contains a non-finite state.");
    }
    const previous = states[Math.max(0, index - 1)];
    const next = states[Math.min(states.length - 1, index + 1)];
    const velocity = Math.hypot(state.velocityXMps, state.velocityYMps);
    const previousVelocity = Math.hypot(previous.velocityXMps, previous.velocityYMps);
    const nextVelocity = Math.hypot(next.velocityXMps, next.velocityYMps);
    return {
      t: state.timeSeconds,
      x: state.x,
      y: state.y,
      headingRad: state.headingRad,
      velocityMps: velocity,
      accelerationMps2: (nextVelocity - previousVelocity) / Math.max(1e-9, next.timeSeconds - previous.timeSeconds),
      angularVelocityRadps: state.angularVelocityRadps,
      curvatureInvM: 0,
    };
  });
  const normalized = normalizeTrajectoryCandidate({ samples });
  if (!normalized.ok) throw new Error(`PathPlanner raw output cannot be normalized: ${normalized.issues[0]?.message ?? "unknown error"}`);
  const events = raw.events.map((event) => {
    if (typeof event?.id !== "string" || !event.id.trim() || !finite(event.timeS)) throw new Error("PathPlanner raw event is invalid.");
    return { id: event.id, timeS: event.timeS };
  });
  return { normalized: normalized.trajectory, events };
}

export function capturePathPlannerRun(
  preparation: Extract<PathPlannerPreparation, { supported: true }>,
  capture: PathPlannerProcessCapture,
): PathPlannerAdapterResult {
  const base = {
    schemaVersion: "bordeaux-pathplanner-capture/1.0" as const,
    adapterVersion: PATHPLANNER_ADAPTER_VERSION,
    requestSha256: preparation.requestSha256,
    invocation: capture.invocation,
    process: { exitCode: capture.exitCode, stdout: capture.stdout, stderr: capture.stderr },
    rawOutput: capture.rawOutput,
  };
  if (capture.exitCode !== 0 || capture.rawOutput === null) {
    return { ...base, normalized: null, events: [], outcome: "failed", failure: "PathPlanner process did not produce a raw output file." };
  }
  try {
    const result = parseRawOutput(capture.rawOutput);
    return { ...base, ...result, outcome: "generated" };
  } catch (error) {
    return {
      ...base,
      normalized: null,
      events: [],
      outcome: "failed",
      failure: error instanceof Error ? error.message : "PathPlanner raw output is invalid.",
    };
  }
}
