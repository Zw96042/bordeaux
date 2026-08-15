import type { PlannerInput, PlannerOptimizationDiagnostics, PlannerResult } from "../types";
import { getPlanner } from "./index";

const EPSILON = 1e-4;

function referenceSample(samples: PlannerResult["samples"], fraction: number) {
  if (fraction <= samples[0].f) return samples[0];
  if (fraction >= samples.at(-1)!.f) return samples.at(-1)!;
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].f >= fraction) high = middle;
    else low = middle + 1;
  }
  const before = samples[low - 1];
  const after = samples[low];
  const progress = (fraction - before.f) / Math.max(1e-9, after.f - before.f);
  const headingDelta = Math.atan2(
    Math.sin(after.headingRad - before.headingRad),
    Math.cos(after.headingRad - before.headingRad),
  );
  return {
    x: before.x + (after.x - before.x) * progress,
    y: before.y + (after.y - before.y) * progress,
    headingRad: before.headingRad + headingDelta * progress,
  };
}

function optimizerFailure(candidate: PlannerResult): string | null {
  if (candidate.samples.length < 2) return "The optimizer returned fewer than two trajectory samples.";
  if (candidate.diagnostics.some((issue) => issue.severity === "error")) {
    return candidate.diagnostics.find((issue) => issue.severity === "error")!.message;
  }
  if (!candidate.optimization
    || !["optimal", "feasible", "equivalent"].includes(candidate.optimization.status ?? "")
    || candidate.optimization.constraintViolations !== 0) {
    return candidate.optimization?.fallbackReason ?? "The optimizer did not return a validated final trajectory.";
  }
  return null;
}

function invariantFailure(input: PlannerInput, interactive: PlannerResult, candidate: PlannerResult): string | null {
  if (Math.abs(candidate.totalDistanceM - interactive.totalDistanceM) > 0.001) {
    return "The optimizer changed the fixed path distance.";
  }
  for (const sample of candidate.samples) {
    if (![sample.t, sample.s, sample.f, sample.x, sample.y, sample.headingRad, sample.velocityMps].every(Number.isFinite)) {
      return "The optimizer returned a non-finite trajectory sample.";
    }
    const expected = referenceSample(interactive.samples, sample.f);
    const headingDelta = Math.atan2(
      Math.sin(sample.headingRad - expected.headingRad),
      Math.cos(sample.headingRad - expected.headingRad),
    );
    if (Math.hypot(sample.x - expected.x, sample.y - expected.y) > 0.001
      || Math.abs(headingDelta) > 0.001) {
      return "The optimizer changed the fixed geometry or heading law.";
    }
  }
  const endpoints = [[interactive.samples[0], candidate.samples[0]], [interactive.samples.at(-1)!, candidate.samples.at(-1)!]];
  for (const [expected, actual] of endpoints) {
    const headingDelta = Math.atan2(
      Math.sin(actual.headingRad - expected.headingRad),
      Math.cos(actual.headingRad - expected.headingRad),
    );
    if (Math.hypot(actual.x - expected.x, actual.y - expected.y) > 0.001
      || Math.abs(headingDelta) > 0.001
      || Math.abs(actual.velocityMps - expected.velocityMps) > 0.001) {
      return "The optimizer changed a fixed endpoint pose or velocity.";
    }
  }
  if (candidate.markers.length !== interactive.markers.length
    || candidate.markers.some((marker, index) => marker.id !== interactive.markers[index].id
      || Math.abs(marker.fraction - interactive.markers[index].fraction) > EPSILON)) {
    return "The optimizer changed the authored event order or placement.";
  }
  for (const waypoint of input.path.waypoints.filter((value) => value.stop)) {
    const nearest = candidate.samples.reduce((best, sample) => (
      Math.hypot(sample.x - waypoint.x, sample.y - waypoint.y)
        < Math.hypot(best.x - waypoint.x, best.y - waypoint.y) ? sample : best
    ));
    if (Math.hypot(nearest.x - waypoint.x, nearest.y - waypoint.y) > 0.001
      || Math.abs(nearest.velocityMps) > 0.001) {
      return "The optimizer changed an authored stop.";
    }
  }
  return null;
}

function fallbackDiagnostics(
  interactive: PlannerResult,
  candidate: PlannerResult,
  status: "equivalent" | "internal-error",
  reason?: string,
): PlannerOptimizationDiagnostics {
  return {
    ...(candidate.optimization ?? {
      plannerUsed: "profiledSpline",
      solveTimeMs: 0,
      totalTimeS: interactive.totalTimeS,
      maxVelocityMps: Math.max(...interactive.samples.map((sample) => Math.abs(sample.velocityMps))),
      maxAccelerationMps2: Math.max(...interactive.samples.map((sample) => Math.abs(sample.accelerationMps2))),
      constraintViolations: 0,
      fallback: false,
    }),
    plannerUsed: "profiledSpline",
    status,
    totalTimeS: interactive.totalTimeS,
    constraintViolations: 0,
    fallback: status === "internal-error",
    ...(reason ? { fallbackReason: reason } : { fallbackReason: undefined }),
  };
}

/**
 * Runs the bounded fixed-geometry optimizer and accepts only a validated time
 * improvement. An equal or slower candidate keeps the trustworthy interactive
 * result without describing it as an optimization win.
 */
export function optimizeFixedGeometryFinal(input: PlannerInput): PlannerResult {
  const interactive = getPlanner("profiledSpline").generate(input);
  let candidate: PlannerResult;
  try {
    candidate = getPlanner("optimizedTrajectory").generate(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Final optimization failed.";
    return {
      ...interactive,
      optimization: fallbackDiagnostics(interactive, interactive, "internal-error", reason),
    };
  }

  const optimizationFailure = optimizerFailure(candidate);
  if (!optimizationFailure && candidate.totalTimeS >= interactive.totalTimeS - EPSILON) {
    return {
      ...interactive,
      optimization: fallbackDiagnostics(interactive, candidate, "equivalent"),
    };
  }
  const failure = optimizationFailure ?? invariantFailure(input, interactive, candidate);
  if (failure) {
    return {
      ...interactive,
      diagnostics: [...interactive.diagnostics, {
        severity: "warning",
        path: `paths.${input.path.name}.planner`,
        message: `Final optimization kept the interactive trajectory: ${failure}`,
      }],
      optimization: fallbackDiagnostics(interactive, candidate, "internal-error", failure),
    };
  }
  return candidate;
}
