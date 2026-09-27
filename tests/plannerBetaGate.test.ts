import { describe, expect, it } from "vitest";
import { buildPlannerBetaVerdict } from "../src/electron/benchmark/plannerBetaGate";
import { buildPlannerBenchmarkReport, type PlannerBenchmarkRun } from "../src/electron/benchmark/plannerReport";

function run(overrides: Partial<PlannerBenchmarkRun>): PlannerBenchmarkRun {
  return {
    planner: "Bordeaux",
    toolVersion: "test",
    benchmarkClass: "fixed-geometry",
    fixtureId: "a",
    deterministicSeed: 7,
    iteration: 1,
    outcome: "generated",
    latencyMs: 10,
    inputSha256: "sha256:input",
    normalizedSha256: "sha256:stable",
    trajectoryTimeS: 1,
    validation: { valid: true, rankingEligible: true, issues: [] },
    raw: {
      input: null, output: "{}", stdout: "", stderr: "",
      invocation: { executable: "test", arguments: [], workingDirectory: "/tmp" },
    },
    ...overrides,
  };
}

const plannerManifest = {
  generatedAt: "2026-08-15T00:00:00.000Z",
  protocol: { repetitions: 1, warmups: 0, latencyGateMs: 15_000 },
  inputs: { corpus: "sha256:corpus" },
  executedArtifacts: { sha256: "sha256:artifacts", files: [] },
  hardware: { cpu: { model: "test cpu" }, platform: "linux" },
  tools: { Bordeaux: { version: "test" }, PathPlanner: { version: "test" }, Choreo: { version: "test" } },
};

const plannerRuns = [
  run({ fixtureId: "a", latencyMs: 180 }),
  run({ fixtureId: "b", latencyMs: 220 }),
  run({ benchmarkClass: "corridor", fixtureId: "c", latencyMs: 2_400 }),
  run({ planner: "PathPlanner", fixtureId: "a", latencyMs: 40, trajectoryTimeS: 1.1 }),
  run({ planner: "PathPlanner", fixtureId: "b", latencyMs: 40, trajectoryTimeS: 0.99 }),
  run({ planner: "Choreo", benchmarkClass: "corridor", fixtureId: "c", latencyMs: 900, trajectoryTimeS: 1.2 }),
];

function plannerReport(overrides: Record<string, unknown> = {}, runs = plannerRuns) {
  return {
    ...buildPlannerBenchmarkReport(plannerManifest, runs),
    finalPlanningEvidence: {
      rawRuns: [
        { deadlineTier: "hard", budgetMs: 30_000, fixtureId: "c", outcome: "generated", latencyMs: 3_100, validation: { valid: true } },
      ],
    },
    ...overrides,
  };
}

// Check names emitted by scripts/renderer-browser-benchmark-electron.cjs.
const rendererCorrectnessChecks = [
  "applicationWorkerTransport", "nativeImagePaintProof", "restoreConflictStaysDirty", "staleProposalBlockedDuringDrag",
  "proposalUsableAfterCancel", "releaseUsesTerminalCoordinates", "releaseStable", "saveIncludesDraft", "closeGuardDirty",
  "undoCancelsDrag", "cancelAutosaveRestored", "commandSurvivesDrag", "commandUndoRestores", "cancelPreservesRedo",
  "pathSwitchCommitsDrag", "openDuringDragKeepsFile", "saveOpenKeepsFile", "renameSurvivesDrag", "moveSurvivesDrag",
  "linkSurvivesDrag",
];

function rendererCandidate(overrides: Record<string, unknown> = {}) {
  return {
    workerBundle: true,
    correctness: Object.fromEntries(rendererCorrectnessChecks.map((name) => [name, true])),
    interactivePlanning: {
      common: { fixture: "3-waypoint profiled spline", correctPaintMs: { p50: 18, p95: 22 }, rawSamples: [18, 22] },
      stress: { fixture: "100-waypoint profiled spline", correctPaintMs: { p50: 74, p95: 84 }, rawSamples: [74, 84] },
    },
    rawTrials: [{ label: "candidate-1" }],
    ...overrides,
  };
}

function rendererReport(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-15T00:00:00.000Z",
    revisions: { upstream: "base", candidate: "head" },
    runtime: { electron: "test", chrome: "test", node: "test" },
    protocol: {
      fixture: "Bordeaux-authored synthetic 3-waypoint common and 100-waypoint stress profiled splines",
      execution: { correctness: "candidate-only child before warmups; excluded from timing" },
    },
    variants: { candidate: rendererCandidate() },
    ...overrides,
  };
}

describe("planner beta gate", () => {
  it("accepts only complete raw evidence that clears every published threshold", () => {
    const verdict = buildPlannerBetaVerdict(plannerReport(), rendererReport(), "2026-08-15T01:00:00.000Z");

    expect(verdict).toMatchObject({
      schemaVersion: "bordeaux-planner-beta-verdict/1.0",
      generatedAt: "2026-08-15T01:00:00.000Z",
      verdict: "accept",
      competitiveClaimsAllowed: true,
      gates: {
        producers: { passed: true, plannerFailures: [], rendererFailedChecks: [] },
        validity: { passed: true, invalidOutputs: 0 },
        quality: { passed: true, comparisons: 3, wins: 2, medianDeficitPercent: 0, p95DeficitPercent: 1.010101 },
        interactivePlanning: { passed: true, commonP95Ms: 22, stressP95Ms: 84 },
        finalPlanning: { passed: true, commonMaxMs: 220, stressMaxMs: 2_400, hardMaxMs: 3_100 },
      },
      blockers: [],
    });
    expect(verdict.evidence).toMatchObject({
      hardware: { platform: "linux" },
      adapters: { PathPlanner: { version: "test" }, Choreo: { version: "test" } },
      raw: { plannerRuns: expect.any(Array), rendererTrials: [{ label: "candidate-1" }] },
    });
  });

  it("rejects renderer evidence whose correctness checks were skipped", () => {
    const comparisonOnly = buildPlannerBetaVerdict(plannerReport(), rendererReport({
      protocol: { execution: { correctness: "skipped by --comparison-only; measured candidate worker transport remains required" } },
      variants: { candidate: rendererCandidate({ correctness: null }) },
    }));
    const withoutCorrectness = buildPlannerBetaVerdict(plannerReport(), rendererReport({
      variants: { candidate: rendererCandidate({ correctness: undefined }) },
    }));
    const emptyCorrectness = buildPlannerBetaVerdict(plannerReport(), rendererReport({
      variants: { candidate: rendererCandidate({ correctness: {} }) },
    }));

    for (const verdict of [comparisonOnly, withoutCorrectness, emptyCorrectness]) {
      expect(verdict.verdict).toBe("reject");
      expect(verdict.competitiveClaimsAllowed).toBe(false);
      expect(verdict.gates.interactivePlanning.passed).toBe(true);
      expect(verdict.gates.producers.passed).toBe(false);
      expect(verdict.blockers).toEqual(["renderer:correctness-missing"]);
    }
  });

  it("rejects renderer evidence with a failed check or no real worker bundle", () => {
    const failedCheck = buildPlannerBetaVerdict(plannerReport(), rendererReport({
      variants: { candidate: rendererCandidate({
        correctness: { ...rendererCandidate().correctness, undoCancelsDrag: false },
      }) },
    }));
    const withoutWorkerBundle = buildPlannerBetaVerdict(plannerReport(), rendererReport({
      variants: { candidate: rendererCandidate({ workerBundle: false }) },
    }));

    expect(failedCheck.verdict).toBe("reject");
    expect(failedCheck.gates.producers).toMatchObject({ passed: false, rendererFailedChecks: ["undoCancelsDrag"] });
    expect(failedCheck.blockers).toEqual(["renderer:correctness-failed"]);
    expect(withoutWorkerBundle.verdict).toBe("reject");
    expect(withoutWorkerBundle.gates.producers).toMatchObject({ passed: false, rendererFailedChecks: ["realWorkerBundle"] });
    expect(withoutWorkerBundle.blockers).toEqual(["renderer:correctness-failed"]);
  });

  it("rejects planner reports whose producer gates failed or are absent", () => {
    const drifted = buildPlannerBetaVerdict(plannerReport({}, [
      ...plannerRuns,
      run({ fixtureId: "a", iteration: 2, latencyMs: 190, normalizedSha256: "sha256:drifted" }),
    ]), rendererReport());
    const withoutGates = buildPlannerBetaVerdict(plannerReport({ gates: undefined }), rendererReport());

    expect(drifted.verdict).toBe("reject");
    expect(drifted.gates.validity.passed).toBe(true);
    expect(drifted.gates.producers).toMatchObject({ passed: false, plannerFailures: ["Bordeaux:a:normalized-output-drift"] });
    expect(drifted.blockers).toEqual(["planner:producer-gates-failed"]);
    expect(withoutGates.verdict).toBe("reject");
    expect(withoutGates.blockers).toEqual(["planner:producer-gates-missing"]);
  });

  it("rejects planner reports from another schema version", () => {
    const olderSchema = buildPlannerBetaVerdict(plannerReport({ schemaVersion: "bordeaux-planner-benchmark/0.9" }), rendererReport());
    const withoutSchema = buildPlannerBetaVerdict(plannerReport({ schemaVersion: undefined }), rendererReport());

    for (const verdict of [olderSchema, withoutSchema]) {
      expect(verdict.verdict).toBe("reject");
      expect(verdict.blockers).toEqual(["planner:schema-mismatch"]);
    }
  });

  it("rejects any invalid output before competitive quality is considered", () => {
    const verdict = buildPlannerBetaVerdict(plannerReport({
      disqualified: [{ planner: "Choreo", fixtureId: "b", outcome: "failed" }],
    }), rendererReport());

    expect(verdict.verdict).toBe("reject");
    expect(verdict.competitiveClaimsAllowed).toBe(false);
    expect(verdict.gates.validity).toMatchObject({ passed: false, invalidOutputs: 1 });
    expect(verdict.blockers).toContain("validity:invalid-output");
  });

  it("uses competitor-relative deficits and rejects a p95 above five percent", () => {
    const comparisons = [
      [1, 1.2],
      [1, 1.1],
      [1, 1.01],
      [1.02, 1],
      [1.06, 1],
    ].map(([bordeauxTrajectoryTimeS, plannerTrajectoryTimeS], index) => ({
      benchmarkClass: "fixed-geometry", fixtureId: String(index), planner: "PathPlanner",
      bordeauxTrajectoryTimeS, plannerTrajectoryTimeS, deltaPercent: 0,
    }));

    const verdict = buildPlannerBetaVerdict(plannerReport({ comparisons }), rendererReport());

    expect(verdict.gates.quality).toMatchObject({
      passed: false,
      medianDeficitPercent: 0,
      p95DeficitPercent: 6,
      wins: 3,
      winRate: 0.6,
    });
    expect(verdict.blockers).toContain("quality:p95-deficit");
  });

  it("fails closed when raw interactive or final-planning evidence is missing", () => {
    const withoutInteractive = buildPlannerBetaVerdict(plannerReport(), rendererReport({ variants: { candidate: {} } }));
    const withoutFinal = buildPlannerBetaVerdict(plannerReport({ rawRuns: [] }), rendererReport());
    const withoutHard = buildPlannerBetaVerdict(plannerReport({ finalPlanningEvidence: { rawRuns: [] } }), rendererReport());

    expect(withoutInteractive.gates.interactivePlanning).toMatchObject({ passed: false, commonP95Ms: null, stressP95Ms: null });
    expect(withoutInteractive.blockers).toEqual(expect.arrayContaining([
      "interactive:common-evidence-missing",
      "interactive:stress-evidence-missing",
    ]));
    expect(withoutFinal.gates.finalPlanning).toMatchObject({ passed: false, commonMaxMs: null, stressMaxMs: null, hardMaxMs: 3_100 });
    expect(withoutFinal.blockers).toEqual(expect.arrayContaining([
      "final:common-evidence-missing",
      "final:stress-evidence-missing",
    ]));
    expect(withoutHard.gates.finalPlanning).toMatchObject({ passed: false, hardMaxMs: null });
    expect(withoutHard.blockers).toContain("final:hard-evidence-missing");
  });
});
