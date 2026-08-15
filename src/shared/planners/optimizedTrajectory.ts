import type {
  PlannerInput,
  PlannerOptimizationDiagnostics,
  PlannerResult,
  TrajectoryPlanner,
  TrajectorySample,
  ValidationIssue,
} from "../types";
import { buildReachabilityInput, countLinearConstraintViolations, insertOptimizationBoundaries } from "./optimizationConstraints";
import { DEFAULT_SAMPLES_PER_SEGMENT, MAX_TRAJECTORY_SAMPLES } from "./limits";
import { profiledSplineOptimizationSeed, profiledSplinePlanner } from "./profiledSpline";
import { solveReachabilityProfile, type ReachabilityStatus } from "./reachability";
import { translationPriorityStartIndex } from "./rotationPriority";
import { validateOptimizedTrajectory, type TrajectoryValidationResult } from "./trajectoryValidation";

const R = (value: number, places = 4) => Number(value.toFixed(places));
const MAX_REFINEMENT_PASSES = 2;

function remapTiming(samples: TrajectorySample[], velocities: number[]): TrajectorySample[] {
  if (samples.length < 2) return samples;

  const times = new Array(samples.length).fill(0);
  for (let i = 1; i < samples.length; i += 1) {
    const ds = Math.max(0, samples[i].s - samples[i - 1].s);
    const avgV = Math.max(1e-6, (velocities[i] + velocities[i - 1]) * 0.5);
    times[i] = times[i - 1] + ds / avgV;
  }

  return samples.map((sample, i) => {
    const dtPrev = i > 0 ? Math.max(1e-6, times[i] - times[i - 1]) : 0;
    const dtNext = i < samples.length - 1 ? Math.max(1e-6, times[i + 1] - times[i]) : dtPrev;
    const accel =
      i === 0
        ? 0
        : i === samples.length - 1
          ? 0
          : (velocities[i + 1] - velocities[i - 1]) / Math.max(1e-6, dtPrev + dtNext);
    const headingDelta = i === 0
      ? 0
      : Math.atan2(
          Math.sin(sample.headingRad - samples[i - 1].headingRad),
          Math.cos(sample.headingRad - samples[i - 1].headingRad),
        );
    return {
      ...sample,
      t: R(times[i], 6),
      velocityMps: R(velocities[i], 6),
      accelerationMps2: R(accel, 6),
      angularVelocityRadps: R(i === 0 ? 0 : headingDelta / dtPrev, 7),
    };
  });
}

function remapProfileForValidation(
  geometrySamples: TrajectorySample[],
  timedSamples: TrajectorySample[],
): TrajectorySample[] {
  let sourceIndex = 0;
  const velocities = geometrySamples.map((sample) => {
    while (sourceIndex < timedSamples.length - 2 && timedSamples[sourceIndex + 1].f < sample.f) sourceIndex += 1;
    for (let candidate = Math.max(0, sourceIndex - 2); candidate <= Math.min(timedSamples.length - 1, sourceIndex + 3); candidate += 1) {
      if (Math.hypot(timedSamples[candidate].x - sample.x, timedSamples[candidate].y - sample.y) <= 1e-8) {
        sourceIndex = candidate;
        return Math.abs(timedSamples[candidate].velocityMps);
      }
    }
    const before = timedSamples[sourceIndex];
    const after = timedSamples[Math.min(timedSamples.length - 1, sourceIndex + 1)];
    const span = Math.max(1e-9, after.f - before.f);
    const ratio = Math.max(0, Math.min(1, (sample.f - before.f) / span));
    const speedSquared = before.velocityMps ** 2
      + (after.velocityMps ** 2 - before.velocityMps ** 2) * ratio;
    return Math.sqrt(Math.max(0, speedSquared));
  });
  return remapTiming(geometrySamples, velocities);
}

export function buildDenseValidationSamples(
  input: PlannerInput,
  timedSamples: TrajectorySample[],
  samplesPerSegment = input.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT,
  validationMultiplier = 2,
): TrajectorySample[] {
  const segmentCount = Math.max(0, input.path.waypoints.length - 1);
  const denseSamplesPerSegment = samplesPerSegment * validationMultiplier;
  if (segmentCount > Math.floor((MAX_TRAJECTORY_SAMPLES - 1) / denseSamplesPerSegment)) {
    throw new Error(`Dense validation requires more than ${MAX_TRAJECTORY_SAMPLES} trajectory samples`);
  }
  const denseGeometry = insertOptimizationBoundaries(
    input,
    profiledSplineOptimizationSeed({ ...input, samplesPerSegment: denseSamplesPerSegment }).samples,
  );
  return remapProfileForValidation(denseGeometry, timedSamples);
}

function timeAtFraction(samples: TrajectorySample[], fraction: number): number {
  if (samples.length === 0) return 0;
  const target = Math.max(0, Math.min(1, fraction));
  if (target <= samples[0].f) return samples[0].t;
  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index];
    if (current.f >= target) {
      const previous = samples[index - 1];
      const span = Math.max(1e-9, current.f - previous.f);
      return previous.t + (current.t - previous.t) * ((target - previous.f) / span);
    }
  }
  return samples[samples.length - 1].t;
}

function diagnostics(
  input: PlannerInput,
  samples: TrajectorySample[],
  solveTimeMs: number,
  status: ReachabilityStatus | "feasible" | "equivalent" | "internal-error",
  iterations: number,
  fallbackReason?: string,
  validation?: TrajectoryValidationResult,
  refinementPasses = 0,
): PlannerOptimizationDiagnostics {
  const maxVelocityMps = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.velocityMps)), 0);
  const maxAccelerationMps2 = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.accelerationMps2)), 0);
  return {
    plannerUsed: "optimizedTrajectory",
    status,
    iterations,
    refinementPasses,
    validatedPoints: validation?.checkedPoints,
    activeConstraints: validation?.activeConstraints,
    solveTimeMs: R(solveTimeMs, 3),
    totalTimeS: R(samples[samples.length - 1]?.t ?? 0, 4),
    maxVelocityMps: R(maxVelocityMps, 4),
    maxAccelerationMps2: R(maxAccelerationMps2, 4),
    constraintViolations: validation?.violations.length
      ?? (status === "optimal" || status === "feasible" ? countLinearConstraintViolations(input, samples) : 0),
    fallback: Boolean(fallbackReason),
    fallbackReason,
  };
}

export const optimizedTrajectoryPlanner: TrajectoryPlanner = {
  id: "optimizedTrajectory",
  generate(input: PlannerInput): PlannerResult {
    const started = performance.now();
    const base = profiledSplinePlanner.generate(input);
    const optimizationSeed = profiledSplineOptimizationSeed(input);
    const solveTimeMs = performance.now() - started;

    if (base.samples.length < 2) {
      const fallbackReason = "Profiled spline did not produce enough samples for optimization.";
      const issue: ValidationIssue = {
        severity: "warning",
        path: `paths.${input.path.name}.planner`,
        message: fallbackReason,
      };
      return {
        ...base,
        planner: "profiledSpline",
        diagnostics: [...base.diagnostics, issue],
        optimization: {
          ...diagnostics(input, base.samples, solveTimeMs, "invalid-input", 0, fallbackReason),
          plannerUsed: "profiledSpline",
        },
      };
    }

    const translationPriority = input.path.ranges?.some((range) => range.rotationPriority === "translation")
      || input.path.waypoints.some((waypoint) => waypoint.headingTransition?.rotationPriority === "translation");
    if (translationPriority) {
      return {
        ...base,
        optimization: {
          ...diagnostics(input, base.samples, performance.now() - started, "equivalent", 0),
          plannerUsed: "profiledSpline",
        },
      };
    }

    if ((input.path.constraints.maxJerk ?? 0) > 0) {
      const reason = "Optimized trajectory does not yet support nonzero translational jerk.";
      return {
        ...base,
        planner: "optimizedTrajectory",
        diagnostics: [...base.diagnostics, {
          severity: "error",
          path: `paths.${input.path.name}.constraints.maxJerk`,
          message: reason,
        }],
        optimization: diagnostics(input, base.samples, performance.now() - started, "invalid-input", 0),
      };
    }

    try {
      let candidateBase = optimizationSeed;
      let samplesPerSegment = input.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
      let totalIterations = 0;
      for (let refinementPasses = 0; refinementPasses <= MAX_REFINEMENT_PASSES; refinementPasses += 1) {
        const optimizationSamples = insertOptimizationBoundaries(input, candidateBase.samples);
        const reachability = solveReachabilityProfile(buildReachabilityInput(input, optimizationSamples));
        totalIterations += reachability.iterations;
        if (reachability.status !== "optimal") {
          const reason = reachability.reason ?? "The fixed-path optimizer could not produce a trajectory.";
          const issue: ValidationIssue = {
            severity: "error",
            path: `paths.${input.path.name}.planner`,
            message: `Optimized trajectory is ${reachability.status}: ${reason}`,
          };
          return {
            ...candidateBase,
            planner: "optimizedTrajectory",
            diagnostics: [...candidateBase.diagnostics, issue],
            optimization: diagnostics(
              input,
              candidateBase.samples,
              performance.now() - started,
              reachability.status,
              totalIterations,
              undefined,
              undefined,
              refinementPasses,
            ),
          };
        }

        const samples = remapTiming(optimizationSamples, reachability.velocities);
        const segmentCount = Math.max(0, input.path.waypoints.length - 1);
        const validationSamples = buildDenseValidationSamples(input, samples, samplesPerSegment);
        const translationPriorityStart = translationPriorityStartIndex(
          input.path,
          validationSamples,
          validationSamples.at(-1)?.s ?? candidateBase.totalDistanceM,
        );
        const validation = validateOptimizedTrajectory(input, validationSamples, {
          skipAngularFromIndex: translationPriorityStart ?? undefined,
        });
        if (validation.violations.length === 0) {
          const totalTimeS = R(samples[samples.length - 1]?.t ?? candidateBase.totalTimeS, 4);
          return {
            planner: "optimizedTrajectory",
            totalTimeS,
            totalDistanceM: candidateBase.totalDistanceM,
            samples,
            markers: candidateBase.markers.map((marker) => ({ ...marker, timeS: R(timeAtFraction(samples, marker.fraction), 6) })),
            diagnostics: candidateBase.diagnostics,
            optimization: diagnostics(
              input,
              samples,
              performance.now() - started,
              translationPriorityStart !== null ? "feasible" : "optimal",
              totalIterations,
              undefined,
              validation,
              refinementPasses,
            ),
          };
        }

        const allRefinable = validation.violations.every((violation) => violation.refinable);
        const nextSamplesPerSegment = samplesPerSegment * 2;
        const withinSampleLimit = segmentCount <= Math.floor((MAX_TRAJECTORY_SAMPLES - 1) / nextSamplesPerSegment);
        if (allRefinable && refinementPasses < MAX_REFINEMENT_PASSES && withinSampleLimit) {
          samplesPerSegment = nextSamplesPerSegment;
          candidateBase = profiledSplineOptimizationSeed({ ...input, samplesPerSegment });
          continue;
        }

        const firstViolation = validation.violations[0];
        const fallbackReason = `Dense validation found ${validation.violations.length} constraint violation${validation.violations.length === 1 ? "" : "s"}: ${firstViolation.message}`;
        const issue: ValidationIssue = {
          severity: "warning",
          path: `paths.${input.path.name}.planner`,
          message: `Optimized trajectory fell back to profiled spline: ${fallbackReason}`,
        };
        const fallback = profiledSplinePlanner.generate({ ...input, samplesPerSegment });
        return {
          ...fallback,
          planner: "profiledSpline",
          diagnostics: [...fallback.diagnostics, issue],
          optimization: {
            ...diagnostics(
              input,
              fallback.samples,
              performance.now() - started,
              "internal-error",
              totalIterations,
              fallbackReason,
              validation,
              refinementPasses,
            ),
            plannerUsed: "profiledSpline",
          },
        };
      }
      throw new Error("Optimizer refinement loop ended without a result.");
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "Optimizer failed.";
      const issue: ValidationIssue = {
        severity: "warning",
        path: `paths.${input.path.name}.planner`,
        message: `Optimized trajectory fell back to profiled spline: ${fallbackReason}`,
      };
      return {
        ...base,
        planner: "profiledSpline",
        diagnostics: [...base.diagnostics, issue],
        optimization: {
          ...diagnostics(input, base.samples, performance.now() - started, "internal-error", 0, fallbackReason),
          plannerUsed: "profiledSpline",
        },
      };
    }
  },
};
