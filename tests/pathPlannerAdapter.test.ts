import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeProjectFile } from "../src/shared/project/fileFormat";
import {
  capturePathPlannerRun,
  PATHPLANNER_JAVA_VERSION,
  PATHPLANNER_VERSION,
  PATHPLANNER_WPILIB_VERSION,
  pathPlannerInvocation,
  pathPlannerUnsupportedConcept,
  preparePathPlannerFixture,
} from "../src/electron/benchmark/pathPlannerAdapter";

const directory = join(dirname(fileURLToPath(import.meta.url)), "../benchmarks/planner-corpus/v1");

describe("PathPlanner benchmark adapter", () => {
  it("prepares a pinned fixed-geometry request without supplying Bordeaux timing", () => {
    const prepared = preparePathPlannerFixture(directory, "fixed-geometry", "fixed-blue-table-trench");
    expect(prepared.supported).toBe(true);
    if (!prepared.supported) return;

    expect(prepared.request.tool).toEqual({
      name: "PathPlannerLib",
      version: PATHPLANNER_VERSION,
      wpilibVersion: PATHPLANNER_WPILIB_VERSION,
      javaVersion: PATHPLANNER_JAVA_VERSION,
    });
    expect(prepared.request.fixture.deterministicSeed).toBe(2026081501);
    expect(prepared.request.path.points.length).toBeGreaterThan(100);
    expect(prepared.request.path.points.every((point) => Number.isFinite(point.headingRad))).toBe(true);
    expect(prepared.request.mapping.centripetal).toContain("wheelCoefficientOfFriction");
    expect(prepared.request.mapping.robotDynamics).toContain("frozen adapter assumptions");
    expect(prepared.requestContents).not.toContain('"samples"');
    expect(prepared.requestSha256).toBe(`sha256:${createHash("sha256").update(prepared.requestContents).digest("hex")}`);
    expect(pathPlannerInvocation("/repo", "/tmp/request.json", "/tmp/raw-output.json")).toEqual({
      executable: "/repo/java/gradlew",
      arguments: ["--no-daemon", "-p", "/repo/benchmarks/adapters/pathplanner", "run", "--args=/tmp/request.json /tmp/raw-output.json"],
      workingDirectory: "/repo",
    });
  });

  it("rejects range semantics that PathPlannerLib cannot reproduce", () => {
    const project = decodeProjectFile(readFileSync(join(directory, "corpus.bordeaux.json"), "utf8")).project;
    const path = structuredClone(project.paths[0]);
    path.ranges = [{
      anchor: "param", f0: 0.1, f1: 0.9,
      maxVel: 2, maxAccel: 2, maxDecel: 1, maxAngVel: 90, maxAngAccel: 180,
    }];
    expect(pathPlannerUnsupportedConcept(path)).toContain("constraint range");
    path.ranges[0].maxDecel = 2;
    path.ranges[0].rotationPriority = "translation";
    expect(pathPlannerUnsupportedConcept(path)).toContain("rotation priority");
  });

  it("reports unsupported mappings instead of dropping them or substituting Bordeaux planning", () => {
    const stopped = preparePathPlannerFixture(directory, "fixed-geometry", "fixed-neutral-stop");
    expect(stopped).toMatchObject({
      supported: false,
      code: "pathplanner:unsupported-concept",
    });
    if (!stopped.supported) expect(stopped.reason).toContain("stops or waits");

    expect(preparePathPlannerFixture(directory, "corridor", "corridor-neutral-slalom")).toMatchObject({
      supported: false,
      code: "pathplanner:headless-corridor-optimization-unavailable",
    });
  });

  it("retains raw process evidence before normalizing a complete fixed-fixture capture", () => {
    const prepared = preparePathPlannerFixture(directory, "fixed-geometry", "fixed-blue-table-trench");
    expect(prepared.supported).toBe(true);
    if (!prepared.supported) return;
    const first = prepared.request.path.points[0];
    const middle = prepared.request.path.points[Math.floor(prepared.request.path.points.length / 2)];
    const last = prepared.request.path.points.at(-1)!;
    const rawOutput = `${JSON.stringify({
      schemaVersion: "bordeaux-pathplanner-raw/1.0",
      toolVersion: PATHPLANNER_VERSION,
      wpilibVersion: PATHPLANNER_WPILIB_VERSION,
      javaRuntimeVersion: "17.0.12+7",
      states: [first, middle, last].map((point, index) => ({
        timeSeconds: index,
        x: point.x,
        y: point.y,
        headingRad: point.headingRad,
        velocityXMps: index === 1 ? 1 : 0,
        velocityYMps: 0,
        angularVelocityRadps: 0,
      })),
      events: [],
    }, null, 2)}\n`;
    const result = capturePathPlannerRun(prepared, {
      invocation: pathPlannerInvocation("/repo", "/tmp/request.json", "/tmp/raw-output.json"),
      exitCode: 0,
      stdout: "PathPlanner harness completed\n",
      stderr: "",
      rawOutput,
    });

    expect(result.outcome).toBe("generated");
    expect(result.rawOutput).toBe(rawOutput);
    expect(result.normalized?.samples).toHaveLength(3);
    expect(result.process.stdout).toBe("PathPlanner harness completed\n");
  });

  it("keeps failed raw evidence and never normalizes it as a result", () => {
    const prepared = preparePathPlannerFixture(directory, "fixed-geometry", "fixed-blue-table-trench");
    expect(prepared.supported).toBe(true);
    if (!prepared.supported) return;
    const result = capturePathPlannerRun(prepared, {
      invocation: pathPlannerInvocation("/repo", "/tmp/request.json", "/tmp/raw-output.json"),
      exitCode: 9,
      stdout: "partial stdout",
      stderr: "solver failed",
      rawOutput: "partial raw file",
    });
    expect(result).toMatchObject({
      outcome: "failed",
      normalized: null,
      rawOutput: "partial raw file",
      process: { exitCode: 9, stdout: "partial stdout", stderr: "solver failed" },
    });
  });
});
