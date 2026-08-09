import type {
  PlannerInput,
  PlannerOptimizationDiagnostics,
  PlannerResult,
  TrajectoryPlanner,
  TrajectorySample,
  ValidationIssue,
} from "../types";
import { profiledSplinePlanner } from "./profiledSpline";
import { activeRanges, effectiveRanges, type EffectiveRange } from "./rotationPriority";

const R = (value: number, places = 4) => Number(value.toFixed(places));
const EPSILON = 1e-9;
const CONSTRAINT_SAFETY = 0.995;

function linearLimits(input: PlannerInput) {
  const freeSpeed = Math.max(0.01, input.robot.maxSpeed || input.path.constraints.maxVel || 0.01);
  return {
    freeSpeed,
    velocity: Math.max(0.01, Math.min(freeSpeed, input.path.constraints.maxVel || freeSpeed)),
    acceleration: Math.max(0.01, input.path.constraints.maxAccel || 0.01),
    deceleration: Math.max(0.01, input.path.constraints.maxDecel ?? input.path.constraints.maxAccel ?? 0.01),
  };
}

type LinearLimits = ReturnType<typeof linearLimits>;

function tightenLinearLimits(limits: LinearLimits, ranges: readonly EffectiveRange[]): LinearLimits {
  let velocity = limits.velocity;
  let acceleration = limits.acceleration;
  let deceleration = limits.deceleration;
  ranges.forEach((range) => {
    if (range.maxVel > 0) velocity = Math.min(velocity, range.maxVel);
    if (range.maxAccel > 0) acceleration = Math.min(acceleration, range.maxAccel);
    const rangeDeceleration = range.maxDecel ?? range.maxAccel;
    if (rangeDeceleration > 0) deceleration = Math.min(deceleration, rangeDeceleration);
  });
  return { ...limits, velocity, acceleration, deceleration };
}

function limitsAtFraction(limits: LinearLimits, ranges: readonly EffectiveRange[], fraction: number): LinearLimits {
  return tightenLinearLimits(limits, activeRanges(ranges, fraction));
}

function intervalLimits(limits: LinearLimits, ranges: readonly EffectiveRange[], before: number, after: number): LinearLimits {
  const start = Math.min(before, after);
  const end = Math.max(before, after);
  return tightenLinearLimits(limits, ranges.filter((range) => (
    Math.min(end, range.end) - Math.max(start, range.start) >= -EPSILON
  )));
}

function linearLimitProfile(input: PlannerInput, samples: readonly TrajectorySample[]) {
  const base = linearLimits(input);
  const ranges = effectiveRanges(input.path, samples, samples.at(-1)?.s ?? 0);
  return {
    points: samples.map((sample) => limitsAtFraction(base, ranges, sample.f)),
    intervals: samples.map((sample, index) => index === 0
      ? limitsAtFraction(base, ranges, sample.f)
      : intervalLimits(base, ranges, samples[index - 1].f, sample.f)),
  };
}

function enforceLinearLimits(
  limits: ReturnType<typeof linearLimitProfile>,
  samples: readonly TrajectorySample[],
  velocities: number[],
): void {
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (let index = 1; index < samples.length; index += 1) {
      const ds = Math.max(0, samples[index].s - samples[index - 1].s);
      const interval = limits.intervals[index];
      const availableAcceleration = interval.acceleration
        * Math.max(0, Math.min(1, 1 - velocities[index - 1] / interval.freeSpeed))
        * CONSTRAINT_SAFETY;
      velocities[index] = Math.min(
        velocities[index],
        interval.velocity,
        Math.sqrt(velocities[index - 1] ** 2 + 2 * availableAcceleration * ds),
      );
    }

    for (let index = samples.length - 2; index >= 0; index -= 1) {
      const ds = Math.max(0, samples[index + 1].s - samples[index].s);
      const interval = limits.intervals[index + 1];
      velocities[index] = Math.min(
        velocities[index],
        interval.velocity,
        Math.sqrt(velocities[index + 1] ** 2 + 2 * interval.deceleration * CONSTRAINT_SAFETY * ds),
      );
    }
  }
}

function countConstraintViolations(input: PlannerInput, samples: readonly TrajectorySample[]): number {
  const profile = linearLimitProfile(input, samples);
  let violations = 0;
  samples.forEach((sample, index) => {
    if (index === 0) {
      const tolerance = Math.max(1e-4, profile.points[0].velocity * 1e-4);
      if (sample.velocityMps > profile.points[0].velocity + tolerance) violations += 1;
      return;
    }
    const previous = samples[index - 1];
    const interval = profile.intervals[index];
    const intervalVelocityTolerance = Math.max(1e-4, interval.velocity * 1e-4);
    if (Math.max(previous.velocityMps, sample.velocityMps) > interval.velocity + intervalVelocityTolerance) violations += 1;
    const ds = sample.s - previous.s;
    if (ds <= EPSILON) return;
    const acceleration = (sample.velocityMps ** 2 - previous.velocityMps ** 2) / (2 * ds);
    const limit = acceleration >= 0
      ? interval.acceleration * Math.max(0, Math.min(1, 1 - previous.velocityMps / interval.freeSpeed))
      : interval.deceleration;
    if (Math.abs(acceleration) > limit + Math.max(1e-3, limit * 1e-3)) violations += 1;
  });
  return violations;
}

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
    const headingDelta =
      i === 0
        ? 0
        : Math.atan2(Math.sin(sample.headingRad - samples[i - 1].headingRad), Math.cos(sample.headingRad - samples[i - 1].headingRad));
    return {
      ...sample,
      t: R(times[i], 4),
      velocityMps: R(velocities[i], 4),
      accelerationMps2: R(accel, 4),
      angularVelocityRadps: R(i === 0 ? 0 : headingDelta / dtPrev, 5),
    };
  });
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

function smoothVelocities(input: PlannerInput, samples: TrajectorySample[]): number[] {
  const limits = linearLimitProfile(input, samples);
  const velocities = samples.map((sample, index) => Math.min(
    limits.points[index].velocity,
    Math.max(0, sample.velocityMps),
  ));

  velocities[0] = input.path.waypoints[0]?.stop
    ? 0
    : Math.min(limits.points[0].velocity, Math.max(0, input.path.startVel || 0));
  velocities[velocities.length - 1] = input.path.waypoints.at(-1)?.stop
    ? 0
    : Math.min(limits.points.at(-1)!.velocity, Math.max(0, input.path.goalVel || 0));

  enforceLinearLimits(limits, samples, velocities);

  const passes = input.smoothingPasses ?? 2;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = velocities.slice();
    for (let i = 1; i < velocities.length - 1; i += 1) {
      if (velocities[i] <= 1e-6) continue;
      next[i] = Math.min(velocities[i], velocities[i - 1] * 0.22 + velocities[i] * 0.56 + velocities[i + 1] * 0.22);
    }
    for (let index = 0; index < velocities.length; index += 1) velocities[index] = next[index];
  }

  // Smoothing can lower a predecessor enough to make the next interval
  // accelerate too quickly. Re-project the final profile onto both envelopes.
  enforceLinearLimits(limits, samples, velocities);
  return velocities;
}

function diagnostics(input: PlannerInput, samples: TrajectorySample[], solveTimeMs: number, fallbackReason?: string): PlannerOptimizationDiagnostics {
  const maxVelocityMps = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.velocityMps)), 0);
  const maxAccelerationMps2 = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.accelerationMps2)), 0);
  return {
    plannerUsed: "optimizedTrajectory",
    solveTimeMs: R(solveTimeMs, 3),
    totalTimeS: R(samples[samples.length - 1]?.t ?? 0, 4),
    maxVelocityMps: R(maxVelocityMps, 4),
    maxAccelerationMps2: R(maxAccelerationMps2, 4),
    constraintViolations: countConstraintViolations(input, samples),
    fallback: Boolean(fallbackReason),
    fallbackReason,
  };
}

export const optimizedTrajectoryPlanner: TrajectoryPlanner = {
  id: "optimizedTrajectory",
  generate(input: PlannerInput): PlannerResult {
    const started = performance.now();
    const base = profiledSplinePlanner.generate(input);
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
        optimization: diagnostics(input, base.samples, solveTimeMs, fallbackReason),
      };
    }

    try {
      const velocities = smoothVelocities(input, base.samples);
      const samples = remapTiming(base.samples, velocities);
      const totalTimeS = R(samples[samples.length - 1]?.t ?? base.totalTimeS, 4);
      const optimization = diagnostics(input, samples, performance.now() - started);
      const constraintIssue: ValidationIssue[] = optimization.constraintViolations > 0 ? [{
        severity: "error",
        path: `paths.${input.path.name}.planner`,
        message: `Optimized trajectory has ${optimization.constraintViolations} final linear constraint violation${optimization.constraintViolations === 1 ? "" : "s"}.`,
      }] : [];

      return {
        planner: "optimizedTrajectory",
        totalTimeS,
        totalDistanceM: base.totalDistanceM,
        samples,
        markers: base.markers.map((marker) => ({ ...marker, timeS: R(timeAtFraction(samples, marker.fraction), 4) })),
        diagnostics: [...base.diagnostics, ...constraintIssue],
        optimization,
      };
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
        optimization: diagnostics(input, base.samples, performance.now() - started, fallbackReason),
      };
    }
  },
};
