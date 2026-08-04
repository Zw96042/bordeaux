import type {
  PlannerInput,
  PlannerOptimizationDiagnostics,
  PlannerResult,
  TrajectoryPlanner,
  TrajectorySample,
  ValidationIssue,
} from "../types";
import { profiledSplinePlanner } from "./profiledSpline";

const R = (value: number, places = 4) => Number(value.toFixed(places));

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
  const maxSpeed = Math.max(0.01, input.robot.maxSpeed || input.path.constraints.maxVel || 0.01);
  const maxVel = Math.max(0.01, Math.min(maxSpeed, input.path.constraints.maxVel || maxSpeed));
  const maxAccel = Math.max(0.01, input.path.constraints.maxAccel || 0.01);
  const maxDecel = Math.max(0.01, input.path.constraints.maxDecel ?? maxAccel);
  const velocities = samples.map((sample) => Math.min(maxVel, Math.max(0, sample.velocityMps)));

  velocities[0] = Math.min(maxVel, Math.max(0, input.path.startVel || 0));
  velocities[velocities.length - 1] = Math.min(maxVel, Math.max(0, input.path.goalVel || 0));

  const stopFractions = new Set(
    input.path.waypoints
      .map((waypoint, index) => (waypoint.stop ? index / Math.max(1, input.path.waypoints.length - 1) : null))
      .filter((fraction): fraction is number => fraction != null),
  );

  for (const fraction of stopFractions) {
    let best = 0;
    let bestDelta = Infinity;
    samples.forEach((sample, index) => {
      const delta = Math.abs(sample.f - fraction);
      if (delta < bestDelta) {
        best = index;
        bestDelta = delta;
      }
    });
    velocities[best] = 0;
  }

  for (let i = 1; i < samples.length; i += 1) {
    const ds = Math.max(0, samples[i].s - samples[i - 1].s);
    velocities[i] = Math.min(velocities[i], Math.sqrt(velocities[i - 1] ** 2 + 2 * maxAccel * ds));
  }

  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const ds = Math.max(0, samples[i + 1].s - samples[i].s);
    velocities[i] = Math.min(velocities[i], Math.sqrt(velocities[i + 1] ** 2 + 2 * maxDecel * ds));
  }

  const passes = input.smoothingPasses ?? 2;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = velocities.slice();
    for (let i = 1; i < velocities.length - 1; i += 1) {
      if (velocities[i] <= 1e-6) continue;
      next[i] = Math.min(velocities[i], velocities[i - 1] * 0.22 + velocities[i] * 0.56 + velocities[i + 1] * 0.22);
    }
    velocities.splice(0, velocities.length, ...next);
  }

  return velocities;
}

function diagnostics(samples: TrajectorySample[], solveTimeMs: number, fallbackReason?: string): PlannerOptimizationDiagnostics {
  const maxVelocityMps = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.velocityMps)), 0);
  const maxAccelerationMps2 = samples.reduce((max, sample) => Math.max(max, Math.abs(sample.accelerationMps2)), 0);
  return {
    plannerUsed: "optimizedTrajectory",
    solveTimeMs: R(solveTimeMs, 3),
    totalTimeS: R(samples[samples.length - 1]?.t ?? 0, 4),
    maxVelocityMps: R(maxVelocityMps, 4),
    maxAccelerationMps2: R(maxAccelerationMps2, 4),
    constraintViolations: 0,
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
      const velocities = smoothVelocities(input, base.samples);
      const samples = remapTiming(base.samples, velocities);
      const totalTimeS = R(samples[samples.length - 1]?.t ?? base.totalTimeS, 4);
      const markerScale = base.totalTimeS > 1e-9 ? totalTimeS / base.totalTimeS : 1;

      return {
        planner: "optimizedTrajectory",
        totalTimeS,
        totalDistanceM: base.totalDistanceM,
        samples,
        markers: base.markers.map((marker) => ({ ...marker, timeS: R(marker.timeS * markerScale, 4) })),
        diagnostics: base.diagnostics,
        optimization: diagnostics(samples, performance.now() - started),
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
        optimization: diagnostics(base.samples, performance.now() - started, fallbackReason),
      };
    }
  },
};

