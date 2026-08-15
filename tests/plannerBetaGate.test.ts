import { describe, expect, it } from "vitest";
import { buildPlannerBetaVerdict } from "../src/electron/benchmark/plannerBetaGate";

function plannerReport(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "bordeaux-planner-benchmark/1.0",
    generatedAt: "2026-08-15T00:00:00.000Z",
    protocol: { repetitions: 2, warmups: 0 },
    inputs: { corpus: "sha256:corpus" },
    executedArtifacts: { sha256: "sha256:artifacts", files: [] },
    hardware: { cpu: { model: "test cpu" }, platform: "linux" },
    tools: { Bordeaux: { version: "test" }, PathPlanner: { version: "test" }, Choreo: { version: "test" } },
    disqualified: [],
    comparisons: [
      { benchmarkClass: "fixed-geometry", fixtureId: "a", planner: "PathPlanner", bordeauxTrajectoryTimeS: 1, plannerTrajectoryTimeS: 1.1, deltaPercent: 10 },
      { benchmarkClass: "fixed-geometry", fixtureId: "b", planner: "PathPlanner", bordeauxTrajectoryTimeS: 1, plannerTrajectoryTimeS: 0.99, deltaPercent: -1 },
      { benchmarkClass: "corridor", fixtureId: "c", planner: "Choreo", bordeauxTrajectoryTimeS: 1, plannerTrajectoryTimeS: 1.2, deltaPercent: 20 },
    ],
    rawRuns: [
      { planner: "Bordeaux", benchmarkClass: "fixed-geometry", fixtureId: "a", iteration: 1, outcome: "generated", latencyMs: 180, validation: { valid: true, rankingEligible: true } },
      { planner: "Bordeaux", benchmarkClass: "fixed-geometry", fixtureId: "b", iteration: 1, outcome: "generated", latencyMs: 220, validation: { valid: true, rankingEligible: true } },
      { planner: "Bordeaux", benchmarkClass: "corridor", fixtureId: "c", iteration: 1, outcome: "generated", latencyMs: 2_400, validation: { valid: true, rankingEligible: true } },
    ],
    finalPlanningEvidence: {
      rawRuns: [
        { deadlineTier: "hard", budgetMs: 30_000, fixtureId: "c", outcome: "generated", latencyMs: 3_100, validation: { valid: true } },
      ],
    },
    ...overrides,
  };
}

function rendererReport(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-08-15T00:00:00.000Z",
    revisions: { upstream: "base", candidate: "head" },
    protocol: { fixture: "synthetic Bordeaux common and stress paths" },
    runtime: { electron: "test", chrome: "test", node: "test" },
    variants: {
      candidate: {
        correctness: { applicationWorkerTransport: true },
        interactivePlanning: {
          common: { correctPaintMs: { p95: 22 }, rawSamples: [18, 22] },
          stress: { correctPaintMs: { p95: 84 }, rawSamples: [74, 84] },
        },
        rawTrials: [{ label: "candidate-1" }],
      },
    },
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
