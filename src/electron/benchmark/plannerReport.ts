export type PlannerName = "Bordeaux" | "PathPlanner" | "Choreo";

export type PlannerBenchmarkRun = {
  planner: PlannerName;
  toolVersion: string;
  benchmarkClass: "fixed-geometry" | "corridor";
  fixtureId: string;
  deterministicSeed: number;
  iteration: number;
  outcome: "generated" | "failed" | "unsupported";
  latencyMs: number | null;
  inputSha256: string;
  normalizedSha256: string | null;
  trajectoryTimeS: number | null;
  validation: { valid: boolean; rankingEligible: boolean; issues: Array<{ code: string; message: string }> } | null;
  raw: {
    input: string | null;
    output: string;
    stdout: string;
    stderr: string;
    invocation: { executable: string; arguments: string[]; workingDirectory: string };
  } | null;
  unsupported?: { code: string; reason: string };
  failure?: string;
};

export type PlannerBenchmarkManifest = {
  generatedAt: string;
  protocol: { repetitions: number; warmups: number; latencyGateMs: number; [key: string]: unknown };
  inputs: Record<string, string>;
  executedArtifacts: {
    sha256: string;
    files: Array<{ path: string; sha256: string; bytes: number }>;
  };
  hardware: Record<string, unknown>;
  tools: Record<string, unknown>;
};

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

export function buildPlannerBenchmarkReport(
  manifest: PlannerBenchmarkManifest,
  runs: readonly PlannerBenchmarkRun[],
) {
  const plannerNames = [...new Set(runs.map((run) => run.planner))].sort();
  const planners = Object.fromEntries(plannerNames.map((planner) => {
    const plannerRuns = runs.filter((run) => run.planner === planner);
    const attempted = plannerRuns.filter((run) => run.outcome !== "unsupported");
    const valid = attempted.filter((run) => run.outcome === "generated" && run.validation?.valid && run.validation.rankingEligible);
    const latency = attempted.flatMap((run) => run.latencyMs === null ? [] : [run.latencyMs]);
    const unsupported = [...new Map(plannerRuns
      .filter((run) => run.outcome === "unsupported" && run.unsupported)
      .map((run) => [`${run.benchmarkClass}:${run.fixtureId}`, {
        benchmarkClass: run.benchmarkClass,
        fixtureId: run.fixtureId,
        deterministicSeed: run.deterministicSeed,
        ...run.unsupported!,
      }])).values()];
    return [planner, {
      attemptedRuns: attempted.length,
      validRuns: valid.length,
      successRate: attempted.length === 0 ? null : valid.length / attempted.length,
      latencyMs: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95) },
      unsupported,
    }];
  })) as Record<string, {
    attemptedRuns: number;
    validRuns: number;
    successRate: number | null;
    latencyMs: { p50: number | null; p95: number | null };
    unsupported: Array<Record<string, unknown>>;
  }>;

  const validRuns = runs.filter((run) => run.outcome === "generated"
    && run.validation?.valid && run.validation.rankingEligible && run.trajectoryTimeS !== null);
  const fixtureKeys = [...new Set(validRuns.map((run) => `${run.benchmarkClass}:${run.fixtureId}`))].sort();
  const comparisons = fixtureKeys.flatMap((key) => {
    const [benchmarkClass, fixtureId] = key.split(":") as ["fixed-geometry" | "corridor", string];
    const baseline = median(validRuns
      .filter((run) => run.planner === "Bordeaux" && run.benchmarkClass === benchmarkClass && run.fixtureId === fixtureId)
      .map((run) => run.trajectoryTimeS!));
    if (baseline === null || baseline <= 0) return [];
    return plannerNames.filter((planner) => planner !== "Bordeaux").flatMap((planner) => {
      const candidate = median(validRuns
        .filter((run) => run.planner === planner && run.benchmarkClass === benchmarkClass && run.fixtureId === fixtureId)
        .map((run) => run.trajectoryTimeS!));
      if (candidate === null) return [];
      return [{
        benchmarkClass,
        fixtureId,
        planner,
        bordeauxTrajectoryTimeS: rounded(baseline),
        plannerTrajectoryTimeS: rounded(candidate),
        deltaPercent: rounded((candidate - baseline) / baseline * 100),
      }];
    });
  });

  const disqualified = runs.filter((run) => run.outcome === "failed"
    || (run.outcome === "generated" && (!run.validation?.valid || !run.validation.rankingEligible)))
    .map((run) => ({
      planner: run.planner,
      benchmarkClass: run.benchmarkClass,
      fixtureId: run.fixtureId,
      iteration: run.iteration,
      outcome: run.outcome,
      issues: run.validation?.issues ?? [],
      failure: run.failure ?? null,
    }));

  const failures: string[] = [];
  if (Array.isArray(manifest.protocol.warmupFailures) && manifest.protocol.warmupFailures.length > 0) {
    failures.push("protocol:warmup-failure");
  }
  disqualified.forEach((run) => failures.push(`${run.planner}:${run.fixtureId}:invalid-or-failed`));
  for (const planner of plannerNames) {
    const p95 = planners[planner].latencyMs.p95;
    if (p95 !== null && p95 > manifest.protocol.latencyGateMs) failures.push(`${planner}:latency-p95`);
  }
  const generatedGroups = new Map<string, PlannerBenchmarkRun[]>();
  runs.filter((run) => run.outcome === "generated").forEach((run) => {
    const key = `${run.planner}:${run.benchmarkClass}:${run.fixtureId}`;
    generatedGroups.set(key, [...(generatedGroups.get(key) ?? []), run]);
  });
  generatedGroups.forEach((group, key) => {
    const digests = new Set(group.map((run) => run.normalizedSha256).filter(Boolean));
    if (digests.size > 1) failures.push(`${key.replace(/:(fixed-geometry|corridor):/, ":")}:normalized-output-drift`);
  });
  const uniqueFailures = [...new Set(failures)];
  const qualityPassed = disqualified.length === 0
    && !uniqueFailures.some((failure) => failure.endsWith("normalized-output-drift") || failure === "protocol:warmup-failure");
  const latencyPassed = !uniqueFailures.some((failure) => failure.endsWith("latency-p95"));

  return {
    schemaVersion: "bordeaux-planner-benchmark/1.0" as const,
    ...manifest,
    planners,
    comparisons,
    disqualified,
    gates: { qualityPassed, latencyPassed, passed: qualityPassed && latencyPassed, failures: uniqueFailures },
    competitiveClaimsAllowed: false,
    rawRuns: runs,
  };
}
