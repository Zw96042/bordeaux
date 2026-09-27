import { PLANNER_BENCHMARK_SCHEMA_VERSION } from "./plannerReport";
import { median, percentile, rounded } from "./stats";

// Experimental and diagnostic. No in-repo script produces the planner report this
// consumes, and nothing binds the planner and renderer evidence to one revision or
// requires the comparisons to cover the pinned corpus. An accepted verdict is not
// sufficient evidence for competitive claims on its own.
const THRESHOLDS = Object.freeze({
  medianDeficitPercent: 2,
  p95DeficitPercent: 5,
  minimumWinRateExclusive: 0.5,
  interactiveCommonP95Ms: 30,
  interactiveStressP95Ms: 100,
  finalCommonMaxMs: 5_000,
  finalStressMaxMs: 15_000,
  finalHardMaxMs: 30_000,
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map((item) => record(item)).filter((item): item is JsonRecord => item !== null)
    : [];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rawInteractiveSamples(candidate: JsonRecord | null, tier: "common" | "stress"): number[] {
  const planning = record(candidate?.interactivePlanning);
  const evidence = record(planning?.[tier]);
  return Array.isArray(evidence?.rawSamples)
    ? evidence.rawSamples.flatMap((value) => finite(value) ?? [])
    : [];
}

function finalLatencies(planner: JsonRecord, benchmarkClass: "fixed-geometry" | "corridor"): number[] {
  return records(planner.rawRuns).flatMap((run) => (
    run.planner === "Bordeaux"
      && run.benchmarkClass === benchmarkClass
      && run.outcome === "generated"
      && record(run.validation)?.valid === true
      ? finite(run.latencyMs) ?? []
      : []
  ));
}

export function buildPlannerBetaVerdict(
  plannerValue: unknown,
  rendererValue: unknown,
  generatedAt = new Date().toISOString(),
) {
  const planner = record(plannerValue) ?? {};
  const renderer = record(rendererValue) ?? {};
  const rendererCandidate = record(record(renderer.variants)?.candidate);
  const blockers: string[] = [];

  if (planner.schemaVersion !== PLANNER_BENCHMARK_SCHEMA_VERSION) blockers.push("planner:schema-mismatch");
  const plannerGates = record(planner.gates);
  const plannerFailures = Array.isArray(plannerGates?.failures)
    ? plannerGates.failures.filter((failure): failure is string => typeof failure === "string")
    : [];
  if (plannerGates === null) blockers.push("planner:producer-gates-missing");
  else if (plannerGates.passed !== true) blockers.push("planner:producer-gates-failed");

  // The renderer benchmark records every candidate check as a boolean and throws
  // before writing a report when one fails; --comparison-only records null instead.
  const rendererChecks = record(rendererCandidate?.correctness);
  const rendererFailedChecks = Object.entries(rendererChecks ?? {})
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  if (rendererCandidate?.workerBundle !== true) rendererFailedChecks.push("realWorkerBundle");
  if (rendererChecks === null || Object.keys(rendererChecks).length === 0) blockers.push("renderer:correctness-missing");
  if (rendererFailedChecks.length > 0) blockers.push("renderer:correctness-failed");
  const producersPassed = blockers.length === 0;

  const disqualified = records(planner.disqualified);
  const rawInvalid = records(planner.rawRuns).filter((run) => run.outcome === "failed"
    || (run.outcome === "generated" && (record(run.validation)?.valid !== true || record(run.validation)?.rankingEligible !== true)));
  const hardRuns = records(record(planner.finalPlanningEvidence)?.rawRuns);
  const invalidHardRuns = hardRuns.filter((run) => run.outcome !== "generated" || record(run.validation)?.valid !== true);
  const invalidOutputs = Math.max(disqualified.length, rawInvalid.length) + invalidHardRuns.length;
  const validityPassed = invalidOutputs === 0 && Array.isArray(planner.rawRuns);
  if (!validityPassed) blockers.push(invalidOutputs > 0 ? "validity:invalid-output" : "validity:raw-evidence-missing");

  const comparisons = records(planner.comparisons).flatMap((comparison) => {
    const bordeaux = finite(comparison.bordeauxTrajectoryTimeS);
    const competitor = finite(comparison.plannerTrajectoryTimeS);
    if (bordeaux === null || competitor === null || competitor <= 0) return [];
    return [{ bordeaux, competitor }];
  });
  const deficits = comparisons.map(({ bordeaux, competitor }) => Math.max(0, (bordeaux - competitor) / competitor * 100));
  const medianDeficit = median(deficits);
  const p95Deficit = percentile(deficits, 0.95);
  const wins = comparisons.filter(({ bordeaux, competitor }) => bordeaux < competitor).length;
  const winRate = comparisons.length > 0 ? wins / comparisons.length : null;
  const qualityPassed = medianDeficit !== null && p95Deficit !== null && winRate !== null
    && medianDeficit <= THRESHOLDS.medianDeficitPercent
    && p95Deficit <= THRESHOLDS.p95DeficitPercent
    && winRate > THRESHOLDS.minimumWinRateExclusive;
  if (comparisons.length === 0) blockers.push("quality:comparison-evidence-missing");
  else {
    if (medianDeficit! > THRESHOLDS.medianDeficitPercent) blockers.push("quality:median-deficit");
    if (p95Deficit! > THRESHOLDS.p95DeficitPercent) blockers.push("quality:p95-deficit");
    if (winRate! <= THRESHOLDS.minimumWinRateExclusive) blockers.push("quality:win-rate");
  }

  const commonInteractiveSamples = rawInteractiveSamples(rendererCandidate, "common");
  const stressInteractiveSamples = rawInteractiveSamples(rendererCandidate, "stress");
  const commonP95Ms = percentile(commonInteractiveSamples, 0.95);
  const stressP95Ms = percentile(stressInteractiveSamples, 0.95);
  if (commonP95Ms === null) blockers.push("interactive:common-evidence-missing");
  else if (commonP95Ms > THRESHOLDS.interactiveCommonP95Ms) blockers.push("interactive:common-p95");
  if (stressP95Ms === null) blockers.push("interactive:stress-evidence-missing");
  else if (stressP95Ms > THRESHOLDS.interactiveStressP95Ms) blockers.push("interactive:stress-p95");
  const interactivePassed = commonP95Ms !== null && stressP95Ms !== null
    && commonP95Ms <= THRESHOLDS.interactiveCommonP95Ms
    && stressP95Ms <= THRESHOLDS.interactiveStressP95Ms;

  const commonFinal = finalLatencies(planner, "fixed-geometry");
  const stressFinal = finalLatencies(planner, "corridor");
  const validHardRuns = hardRuns.filter((run) => run.deadlineTier === "hard"
    && run.budgetMs === THRESHOLDS.finalHardMaxMs
    && run.outcome === "generated"
    && record(run.validation)?.valid === true);
  const commonMaxMs = commonFinal.length > 0 ? Math.max(...commonFinal) : null;
  const stressMaxMs = stressFinal.length > 0 ? Math.max(...stressFinal) : null;
  const hardLatencies = validHardRuns.flatMap((run) => finite(run.latencyMs) ?? []);
  const hardMaxMs = hardLatencies.length > 0 ? Math.max(...hardLatencies) : null;
  if (commonMaxMs === null) blockers.push("final:common-evidence-missing");
  else if (commonMaxMs > THRESHOLDS.finalCommonMaxMs) blockers.push("final:common-deadline");
  if (stressMaxMs === null) blockers.push("final:stress-evidence-missing");
  else if (stressMaxMs > THRESHOLDS.finalStressMaxMs) blockers.push("final:stress-deadline");
  if (hardMaxMs === null) blockers.push("final:hard-evidence-missing");
  else if (hardMaxMs > THRESHOLDS.finalHardMaxMs) blockers.push("final:hard-timeout");
  const finalPassed = commonMaxMs !== null && stressMaxMs !== null && hardMaxMs !== null
    && commonMaxMs <= THRESHOLDS.finalCommonMaxMs
    && stressMaxMs <= THRESHOLDS.finalStressMaxMs
    && hardMaxMs <= THRESHOLDS.finalHardMaxMs;

  const uniqueBlockers = [...new Set(blockers)];
  const passed = producersPassed && validityPassed && qualityPassed && interactivePassed && finalPassed;
  const tools = record(planner.tools) ?? {};
  const rendererTrials = records(rendererCandidate?.rawTrials);
  const rendererRuntime = record(renderer.runtime) ?? record(rendererTrials[0]?.runtime) ?? {};

  return {
    schemaVersion: "bordeaux-planner-beta-verdict/1.0" as const,
    generatedAt,
    verdict: passed ? "accept" as const : "reject" as const,
    competitiveClaimsAllowed: passed,
    thresholds: THRESHOLDS,
    gates: {
      producers: { passed: producersPassed, plannerFailures, rendererFailedChecks },
      validity: { passed: validityPassed, invalidOutputs },
      quality: {
        passed: qualityPassed,
        comparisons: comparisons.length,
        wins,
        winRate: winRate === null ? null : rounded(winRate),
        medianDeficitPercent: medianDeficit === null ? null : rounded(medianDeficit),
        p95DeficitPercent: p95Deficit === null ? null : rounded(p95Deficit),
      },
      interactivePlanning: {
        passed: interactivePassed,
        commonP95Ms: commonP95Ms === null ? null : rounded(commonP95Ms),
        stressP95Ms: stressP95Ms === null ? null : rounded(stressP95Ms),
      },
      finalPlanning: {
        passed: finalPassed,
        commonMaxMs: commonMaxMs === null ? null : rounded(commonMaxMs),
        stressMaxMs: stressMaxMs === null ? null : rounded(stressMaxMs),
        hardMaxMs: hardMaxMs === null ? null : rounded(hardMaxMs),
      },
    },
    blockers: uniqueBlockers,
    evidence: {
      hardware: record(planner.hardware) ?? {},
      runtime: { planner: tools.Bordeaux ?? null, renderer: rendererRuntime },
      fixtures: { planner: record(planner.inputs) ?? {}, renderer: record(renderer.protocol) ?? {} },
      adapters: { PathPlanner: tools.PathPlanner ?? null, Choreo: tools.Choreo ?? null },
      executedArtifacts: record(planner.executedArtifacts) ?? null,
      raw: { plannerRuns: records(planner.rawRuns), rendererTrials },
    },
  };
}
