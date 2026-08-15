import { describe, expect, it } from "vitest";
import { buildPlannerBenchmarkReport, type PlannerBenchmarkRun } from "../src/electron/benchmark/plannerReport";

function run(overrides: Partial<PlannerBenchmarkRun> = {}): PlannerBenchmarkRun {
  return {
    planner: "Bordeaux",
    toolVersion: "test",
    benchmarkClass: "fixed-geometry",
    fixtureId: "fixed-a",
    deterministicSeed: 7,
    iteration: 1,
    outcome: "generated",
    latencyMs: 10,
    inputSha256: "sha256:input",
    normalizedSha256: "sha256:stable",
    trajectoryTimeS: 2,
    validation: { valid: true, rankingEligible: true, issues: [] },
    raw: {
      input: null, output: "{}", stdout: "", stderr: "",
      invocation: { executable: "test", arguments: [], workingDirectory: "/tmp" },
    },
    ...overrides,
  };
}

const manifest = {
  generatedAt: "2026-08-15T00:00:00.000Z",
  protocol: { repetitions: 2, warmups: 1, latencyGateMs: 100 },
  inputs: { corpus: "sha256:corpus" },
  executedArtifacts: {
    sha256: "sha256:artifacts",
    files: [{ path: "dist-electron/example.js", sha256: "sha256:example", bytes: 7 }],
  },
  hardware: { platform: "linux" },
  tools: { Bordeaux: { version: "test" } },
};

describe("planner benchmark report", () => {
  it("computes validity-first latency and trajectory comparisons", () => {
    const runs = [
      run({ iteration: 1, latencyMs: 10 }),
      run({ iteration: 2, latencyMs: 20 }),
      run({ planner: "Choreo", iteration: 1, latencyMs: 40, trajectoryTimeS: 1.8, normalizedSha256: "sha256:choreo" }),
      run({ planner: "Choreo", iteration: 2, latencyMs: 60, trajectoryTimeS: 1.8, normalizedSha256: "sha256:choreo" }),
      run({ planner: "PathPlanner", outcome: "unsupported", latencyMs: null, trajectoryTimeS: null,
        normalizedSha256: null, validation: null, raw: null, unsupported: { code: "no-corridor", reason: "No headless optimizer" } }),
    ];
    const report = buildPlannerBenchmarkReport(manifest, runs);

    expect(report.planners.Bordeaux).toMatchObject({ successRate: 1, latencyMs: { p50: 10, p95: 20 } });
    expect(report.planners.PathPlanner.unsupported).toHaveLength(1);
    expect(report.comparisons).toEqual([expect.objectContaining({
      fixtureId: "fixed-a",
      planner: "Choreo",
      bordeauxTrajectoryTimeS: 2,
      plannerTrajectoryTimeS: 1.8,
      deltaPercent: -10,
    })]);
    expect(report.gates).toMatchObject({ qualityPassed: true, latencyPassed: true, passed: true });
    expect(report.competitiveClaimsAllowed).toBe(false);
  });

  it("disqualifies invalid output before time comparison and fails quality", () => {
    const report = buildPlannerBenchmarkReport(manifest, [
      run(),
      run({ planner: "Choreo", trajectoryTimeS: 1, validation: { valid: false, rankingEligible: false, issues: [{ code: "collision", message: "collision" }] } }),
    ]);
    expect(report.comparisons).toEqual([]);
    expect(report.disqualified).toEqual([expect.objectContaining({ planner: "Choreo", fixtureId: "fixed-a" })]);
    expect(report.gates).toMatchObject({ qualityPassed: false, passed: false });
  });

  it("fails deterministic-output and latency gates without enabling claims", () => {
    const report = buildPlannerBenchmarkReport(manifest, [
      run({ iteration: 1, latencyMs: 90, normalizedSha256: "sha256:first" }),
      run({ iteration: 2, latencyMs: 120, normalizedSha256: "sha256:second" }),
    ]);
    expect(report.gates.failures).toEqual(expect.arrayContaining([
      "Bordeaux:fixed-a:normalized-output-drift",
      "Bordeaux:latency-p95",
    ]));
    expect(report.gates.passed).toBe(false);
    expect(report.competitiveClaimsAllowed).toBe(false);
  });
});
