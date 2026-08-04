import type { ConstraintRange, PathDoc, PlannerResult, RobotConfig, TrajectorySample } from "../types";
import { LABVIEW_BDX_MAX_TRAJECTORY_POINTS } from "../export/labviewBdxReader";
import { headingTransitionWindows, segmentHeadingLaws, type HeadingTransitionWindow } from "./headingTransitions";

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

type EffectiveRange = ConstraintRange & { start: number; end: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function waypointFractions(path: PathDoc, samples: readonly TrajectorySample[]): number[] {
  let cursor = 0;
  return path.waypoints.map((waypoint, waypointIndex) => {
    if (waypointIndex === path.waypoints.length - 1) return samples.at(-1)?.f ?? 1;
    let best = cursor;
    let bestDistance = Infinity;
    for (let index = cursor; index < samples.length; index += 1) {
      const distance = Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    cursor = best;
    return samples[best]?.f ?? 0;
  });
}

function effectiveRanges(path: PathDoc, samples: readonly TrajectorySample[], totalDistance: number): EffectiveRange[] {
  const waypointF = waypointFractions(path, samples);
  return (path.ranges ?? []).map((range) => {
    let start = range.f0;
    let end = range.f1;
    if (range.anchor === "dist") {
      start = (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON);
      end = (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON);
    } else if (range.anchor === "wp") {
      const localFraction = (segmentValue: number | undefined, local: number | undefined, fallback: number) => {
        if (local == null) return waypointF[clamp(Math.round(segmentValue ?? fallback), 0, waypointF.length - 1)] ?? 0;
        const segment = clamp(Math.round(segmentValue ?? 0), 0, Math.max(0, waypointF.length - 2));
        return (waypointF[segment] ?? 0) + ((waypointF[segment + 1] ?? 1) - (waypointF[segment] ?? 0)) * clamp(local, 0, 1);
      };
      start = localFraction(range.w0, range.t0, 0);
      end = localFraction(range.w1, range.t1, waypointF.length - 1);
    }
    return { ...range, start: clamp(Math.min(start, end), 0, 1), end: clamp(Math.max(start, end), 0, 1) };
  });
}

function activeRanges(ranges: readonly EffectiveRange[], fraction: number): EffectiveRange[] {
  return ranges.filter((range) => fraction >= range.start - EPSILON && fraction <= range.end + EPSILON);
}

function translationHasPriorityForInterval(
  ranges: readonly EffectiveRange[],
  transitions: readonly HeadingTransitionWindow[],
  before: number,
  after: number,
): boolean {
  const start = Math.min(before, after);
  const end = Math.max(before, after);
  const overlaps = (candidateStart: number, candidateEnd: number) => (
    Math.min(end, candidateEnd) - Math.max(start, candidateStart) >= -EPSILON
  );
  const active = ranges.filter((range) => overlaps(range.start, range.end));
  const activeTransitions = transitions.filter((transition) => overlaps(transition.start, transition.end));
  return active.length + activeTransitions.length > 0
    && active.every((range) => range.rotationPriority === "translation")
    && activeTransitions.every((transition) => transition.rotationPriority === "translation");
}

function angularLimits(path: PathDoc, ranges: readonly EffectiveRange[], fraction: number) {
  let velocity = path.constraints.maxAngVel * DEG;
  let acceleration = path.constraints.maxAngAccel * DEG;
  let deceleration = (path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * DEG;
  activeRanges(ranges, fraction).forEach((range) => {
    velocity = Math.min(velocity, range.maxAngVel * DEG);
    acceleration = Math.min(acceleration, range.maxAngAccel * DEG);
    deceleration = Math.min(deceleration, range.maxAngAccel * DEG);
  });
  return {
    velocity: Math.max(velocity, EPSILON),
    acceleration: Math.max(acceleration, EPSILON),
    deceleration: Math.max(deceleration, EPSILON),
  };
}

function intervalAngularLimits(path: PathDoc, ranges: readonly EffectiveRange[], before: number, after: number) {
  const first = angularLimits(path, ranges, before);
  const second = angularLimits(path, ranges, after);
  return {
    velocity: Math.min(first.velocity, second.velocity),
    acceleration: Math.min(first.acceleration, second.acceleration),
    deceleration: Math.min(first.deceleration, second.deceleration),
  };
}

function slewOmega(omega: number, target: number, limits: ReturnType<typeof angularLimits>, dt: number): number {
  const reversing = Math.sign(target) !== 0 && Math.sign(omega) !== 0 && Math.sign(target) !== Math.sign(omega);
  const increasing = Math.sign(target) === Math.sign(omega) && Math.abs(target) > Math.abs(omega);
  const rate = reversing
    ? Math.min(limits.acceleration, limits.deceleration)
    : increasing ? limits.acceleration : limits.deceleration;
  return omega + clamp(target - omega, -rate * dt, rate * dt);
}

function trackedStep(
  actual: number,
  omega: number,
  desiredNow: number,
  desiredBefore: number,
  limits: ReturnType<typeof angularLimits>,
  dt: number,
): { actual: number; omega: number } {
  const error = desiredNow - actual;
  const desiredOmega = clamp((desiredNow - desiredBefore) / dt, -limits.velocity, limits.velocity);
  // A pure error/dt target keeps accelerating until the heading is reached,
  // which carries angular momentum through the target and creates a visible
  // overshoot/reversal. Cap the catch-up component by the speed that can
  // still brake inside the remaining error, including a one-tick margin for
  // the fixed-period semi-implicit integration used by the planners.
  const brakingOmega = Math.max(0, Math.sqrt(2 * limits.deceleration * Math.abs(error)) - limits.deceleration * dt);
  let targetOmega = clamp(desiredOmega + Math.sign(error) * brakingOmega, -limits.velocity, limits.velocity);
  const exactOmega = error / dt;
  const exactRate = Math.sign(exactOmega) !== 0 && Math.sign(omega) !== 0 && Math.sign(exactOmega) !== Math.sign(omega)
    ? Math.min(limits.acceleration, limits.deceleration)
    : Math.abs(exactOmega) > Math.abs(omega) ? limits.acceleration : limits.deceleration;
  if (Math.abs(exactOmega) <= limits.velocity + EPSILON && Math.abs(exactOmega - omega) <= exactRate * dt + EPSILON) {
    targetOmega = exactOmega;
  }
  const nextOmega = slewOmega(omega, targetOmega, limits, dt);
  return { actual: actual + nextOmega * dt, omega: nextOmega };
}

function samplePeriod(path: PathDoc, samples: readonly TrajectorySample[]): number {
  if (path.labview?.samplePeriodS && path.labview.samplePeriodS >= 0.001) return path.labview.samplePeriodS;
  let best = Infinity;
  for (let index = 1; index < samples.length; index += 1) {
    const dt = samples[index].t - samples[index - 1].t;
    if (dt > EPSILON) best = Math.min(best, dt);
  }
  return Number.isFinite(best) ? Math.max(0.01, Math.min(0.05, best)) : 0.02;
}

function hasAngularViolation(path: PathDoc, ranges: readonly EffectiveRange[], samples: readonly TrajectorySample[]): boolean {
  let previousAcceleration: number | undefined;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const limits = index === 0
      ? angularLimits(path, ranges, sample.f)
      : intervalAngularLimits(path, ranges, samples[index - 1].f, sample.f);
    if (Math.abs(sample.angularVelocityRadps) > limits.velocity * 1.02) return true;
    if (index === 0) continue;
    const previous = samples[index - 1];
    const dt = sample.t - previous.t;
    if (dt <= EPSILON) continue;
    const acceleration = Math.abs(sample.angularVelocityRadps - previous.angularVelocityRadps) / dt;
    const reversing = Math.sign(sample.angularVelocityRadps) !== 0
      && Math.sign(previous.angularVelocityRadps) !== 0
      && Math.sign(sample.angularVelocityRadps) !== Math.sign(previous.angularVelocityRadps);
    const limit = reversing
      ? Math.min(limits.acceleration, limits.deceleration)
      : Math.abs(sample.angularVelocityRadps) > Math.abs(previous.angularVelocityRadps)
        ? limits.acceleration
        : limits.deceleration;
    if (acceleration > limit * 1.02) return true;
    const signedAcceleration = (sample.angularVelocityRadps - previous.angularVelocityRadps) / dt;
    if (previousAcceleration !== undefined && (path.constraints.maxAngJerk ?? 0) > 0) {
      const jerk = Math.abs(signedAcceleration - previousAcceleration) / dt;
      if (jerk > path.constraints.maxAngJerk! * DEG * 1.02) return true;
