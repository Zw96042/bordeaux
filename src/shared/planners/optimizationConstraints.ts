import type { PlannerInput, TrajectorySample } from "../types";
import { robotHardLimits } from "../robotLimits";
import { headingTransitionWindows, segmentHeadingLaws } from "./headingTransitions";
import { MAX_TRAJECTORY_SAMPLES } from "./limits";
import { buildDrivetrainProjection } from "./drivetrainProjection";
import { buildCanonicalPathState, findDynamicHeadingStops, interpolatePathPoint } from "./pathState";
import {
  activeRanges,
  effectiveRanges,
  translationPriorityStartIndex,
  type EffectiveRange,
} from "./rotationPriority";
import type { AffineScalarAccelerationConstraint, ReachabilityInput } from "./reachability";

const EPSILON = 1e-9;
const NUMERICAL_SAFETY = 0.99;
const DRIVETRAIN_SAFETY = 0.95;
const MODULE_MOTOR_SAFETY = 0.95;
const DEG = Math.PI / 180;

export interface LinearLimits {
  freeSpeed: number;
  motorAcceleration: number;
  velocity: number;
  acceleration: number;
  deceleration: number;
}

export interface LinearConstraintProfile {
  points: LinearLimits[];
  intervals: LinearLimits[];
}

function baseLinearLimits(input: PlannerInput): LinearLimits {
  const velocityCap = Math.max(0.01, input.robot.maxSpeed || input.path.constraints.maxVel || 0.01);
  const hardLimits = robotHardLimits(input.robot);
  const acceleration = Math.max(0.01, input.path.constraints.maxAccel || 0.01);
  return {
    freeSpeed: velocityCap,
    motorAcceleration: Math.min(acceleration, hardLimits?.motorAccelMps2 ?? acceleration),
    velocity: Math.max(0.01, Math.min(velocityCap, input.path.constraints.maxVel || velocityCap)),
    acceleration,
    deceleration: Math.max(0.01, input.path.constraints.maxDecel ?? input.path.constraints.maxAccel ?? 0.01),
  };
}

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
  return { ...limits, velocity, acceleration, deceleration, motorAcceleration: Math.min(limits.motorAcceleration, acceleration) };
}

function intervalRanges(ranges: readonly EffectiveRange[], before: number, after: number): EffectiveRange[] {
  const start = Math.min(before, after);
  const end = Math.max(before, after);
  return ranges.filter((range) => Math.min(end, range.end) - Math.max(start, range.start) > EPSILON);
}

function interpolateSample(before: TrajectorySample, after: TrajectorySample, fraction: number): TrajectorySample {
  const span = Math.max(EPSILON, after.f - before.f);
  const ratio = Math.max(0, Math.min(1, (fraction - before.f) / span));
  const mix = (first: number, second: number) => first + (second - first) * ratio;
  const headingDelta = Math.atan2(
    Math.sin(after.headingRad - before.headingRad),
    Math.cos(after.headingRad - before.headingRad),
  );
  return {
    i: 0,
    t: mix(before.t, after.t),
    s: mix(before.s, after.s),
    f: fraction,
    x: mix(before.x, after.x),
    y: mix(before.y, after.y),
    headingRad: before.headingRad + headingDelta * ratio,
    velocityMps: mix(before.velocityMps, after.velocityMps),
    accelerationMps2: mix(before.accelerationMps2, after.accelerationMps2),
    angularVelocityRadps: mix(before.angularVelocityRadps, after.angularVelocityRadps),
    curvatureInvM: mix(before.curvatureInvM, after.curvatureInvM),
  };
}

export function insertOptimizationBoundaries(
  input: PlannerInput,
  samples: readonly TrajectorySample[],
): TrajectorySample[] {
  if (samples.length < 2) return [...samples];
  const totalDistance = samples.at(-1)?.s ?? 0;
  const ranges = effectiveRanges(input.path, samples, totalDistance);
  const state = buildCanonicalPathState(input.path, samples);
  const waypointFractions = state.waypointSampleIndices.map((index) => samples[index]?.f ?? 0);
  const laws = segmentHeadingLaws(input.path, false);
  const breaks = input.path.waypoints.slice(0, -1).map((waypoint) => Boolean(waypoint.turnInPlace));
  const transitions = headingTransitionWindows(
    input.path.waypoints,
    laws,
    breaks,
    waypointFractions,
    totalDistance,
  );
  const boundaries = [...ranges.flatMap((range) => [range.start, range.end]), ...transitions.flatMap((transition) => [transition.start, transition.end])]
    .filter((fraction) => fraction > EPSILON && fraction < 1 - EPSILON)
    .sort((left, right) => left - right)
    .filter((fraction, index, values) => index === 0 || Math.abs(fraction - values[index - 1]) > EPSILON);
  const missing = boundaries.filter((fraction) => !samples.some((sample) => Math.abs(sample.f - fraction) <= EPSILON));
  if (samples.length + missing.length > MAX_TRAJECTORY_SAMPLES) {
    throw new Error(`Optimization boundaries require more than ${MAX_TRAJECTORY_SAMPLES} trajectory samples`);
  }

  const result = [...samples];
  for (const fraction of missing) {
    const afterIndex = result.findIndex((sample) => sample.f > fraction);
    if (afterIndex <= 0) continue;
    result.splice(afterIndex, 0, interpolateSample(result[afterIndex - 1], result[afterIndex], fraction));
  }
  return result.map((sample, index) => ({ ...sample, i: index }));
}

function angularVelocityLimitForInterval(
  input: PlannerInput,
  ranges: readonly EffectiveRange[],
  before: number,
  after: number,
): number {
  let limit = input.path.constraints.maxAngVel * DEG;
  for (const range of intervalRanges(ranges, before, after)) limit = Math.min(limit, range.maxAngVel * DEG);
  return limit;
}

function angularAccelerationLimitsForInterval(
  input: PlannerInput,
  ranges: readonly EffectiveRange[],
  before: number,
  after: number,
): { acceleration: number; deceleration: number } {
  let acceleration = input.path.constraints.maxAngAccel * DEG;
  let deceleration = (input.path.constraints.maxAngDecel ?? input.path.constraints.maxAngAccel) * DEG;
  for (const range of intervalRanges(ranges, before, after)) {
    acceleration = Math.min(acceleration, range.maxAngAccel * DEG);
    deceleration = Math.min(deceleration, range.maxAngAccel * DEG);
  }
  return { acceleration, deceleration };
}

export function buildLinearConstraintProfile(input: PlannerInput, samples: readonly TrajectorySample[]): LinearConstraintProfile {
  const base = baseLinearLimits(input);
  const ranges = effectiveRanges(input.path, samples, samples.at(-1)?.s ?? 0);
  return {
    points: samples.map((sample) => tightenLinearLimits(base, activeRanges(ranges, sample.f))),
    intervals: samples.slice(1).map((sample, index) => tightenLinearLimits(
      base,
      intervalRanges(ranges, samples[index].f, sample.f),
    )),
  };
}

/**
 * Adapts Bordeaux's authored limits and geometry-derived velocity envelope to
 * the isolated scalar reachability solver.
 */
export function buildReachabilityInput(
  input: PlannerInput,
  samples: readonly TrajectorySample[],
): ReachabilityInput {
  const profile = buildLinearConstraintProfile(input, samples);
  const ranges = effectiveRanges(input.path, samples, samples.at(-1)?.s ?? 0);
  const translationPriorityStart = translationPriorityStartIndex(
    input.path,
    samples,
    samples.at(-1)?.s ?? 0,
  );
  const initialHeadingBreaks = translationPriorityStart === null ? new Set<number>() : new Set([translationPriorityStart]);
  const preliminaryState = buildCanonicalPathState(
    input.path,
    samples,
    initialHeadingBreaks,
  );
  const dynamicHeadingStops = findDynamicHeadingStops(
    preliminaryState,
    translationPriorityStart ?? undefined,
  );
  const state = buildCanonicalPathState(
    input.path,
    samples,
    new Set([...initialHeadingBreaks, ...dynamicHeadingStops]),
    dynamicHeadingStops,
  );
  const drivetrain = buildDrivetrainProjection(
    state,
    input.robot,
    profile.intervals.map((limits) => (
      (input.path.constraints.maxCentripetalAccel ?? limits.acceleration)
      * DRIVETRAIN_SAFETY
    )),
    MODULE_MOTOR_SAFETY,
  );
  const curvatureVelocityLimits = state.points.map((point, index) => {
    const lateralLimit = input.path.constraints.maxCentripetalAccel ?? Math.min(
      profile.intervals[index - 1]?.acceleration ?? Number.POSITIVE_INFINITY,
      profile.intervals[index]?.acceleration ?? Number.POSITIVE_INFINITY,
    );
    return Math.abs(point.curvatureInvM) > EPSILON
      ? Math.sqrt(Math.max(0, lateralLimit * NUMERICAL_SAFETY) / Math.abs(point.curvatureInvM))
      : Number.POSITIVE_INFINITY;
  });
  const intervalCurvatureVelocityLimits = state.points.slice(1).map((point, index) => {
    const curvature = Math.abs((state.points[index].curvatureInvM + point.curvatureInvM) * 0.5);
    const lateralLimit = input.path.constraints.maxCentripetalAccel ?? profile.intervals[index].acceleration;
    return curvature > EPSILON
      ? Math.sqrt(Math.max(0, lateralLimit * NUMERICAL_SAFETY) / curvature)
      : Number.POSITIVE_INFINITY;
  });
  const startVelocity = input.path.waypoints[0]?.stop
    ? 0
    : Math.min(profile.points[0].velocity, Math.max(0, input.path.startVel || 0));
  const goalVelocity = input.path.waypoints.at(-1)?.stop
    ? 0
    : Math.min(profile.points.at(-1)!.velocity, Math.max(0, input.path.goalVel || 0));
  const angularIntervalVelocityLimits = samples.slice(1).map((sample, index) => {
    const before = samples[index];
    const distance = sample.s - before.s;
    const waypointIndex = state.points[index + 1].waypointIndex;
    const stationaryTurnBoundary = state.points[index + 1].stop
      && waypointIndex !== undefined
      && Boolean(input.path.waypoints[waypointIndex]?.turnInPlace);
    if (stationaryTurnBoundary
      || (translationPriorityStart !== null && index + 1 >= translationPriorityStart)
      || distance <= EPSILON) return Number.POSITIVE_INFINITY;
    const headingDelta = state.points[index + 1].headingRad - state.points[index].headingRad;
    const headingRatePerM = Math.abs(headingDelta / distance);
    return angularVelocityLimitForInterval(input, ranges, before.f, sample.f)
      / Math.max(headingRatePerM, EPSILON)
      * NUMERICAL_SAFETY;
  });
  const angularAccelerationConstraints = state.points.slice(1).map((point, index): AffineScalarAccelerationConstraint[] => {
    const before = state.points[index];
    const stationaryTurnBoundary = (candidate: typeof point) => candidate.stop
      && candidate.waypointIndex !== undefined
      && Boolean(input.path.waypoints[candidate.waypointIndex]?.turnInPlace);
    if (stationaryTurnBoundary(before)
      || stationaryTurnBoundary(point)
      || (translationPriorityStart !== null && index + 1 >= translationPriorityStart)) return [];
    const midpoint = interpolatePathPoint(before, point);
    const limits = angularAccelerationLimitsForInterval(input, ranges, before.f, point.f);
    const direction = Math.sign(midpoint.headingDerivativeRadPerM);
    if (direction === 0) {
      return [{
        u: 0,
        x: midpoint.headingSecondDerivativeRadPerM2,
        minimum: -limits.acceleration * NUMERICAL_SAFETY,
        maximum: limits.acceleration * NUMERICAL_SAFETY,
        label: "angular-acceleration",
      }];
    }
    return [{
      u: direction * midpoint.headingDerivativeRadPerM,
      x: direction * midpoint.headingSecondDerivativeRadPerM2,
      label: "angular-acceleration",
    }];
  });
  return {
    positions: samples.map((sample) => sample.s),
    velocityLimits: samples.map((_, index) => Math.min(
      profile.points[index].velocity,
      profile.intervals[index - 1]?.velocity ?? Number.POSITIVE_INFINITY,
      profile.intervals[index]?.velocity ?? Number.POSITIVE_INFINITY,
      drivetrain.pointVelocityLimits[index] * NUMERICAL_SAFETY,
      (drivetrain.intervalVelocityLimits[index - 1] ?? Number.POSITIVE_INFINITY) * NUMERICAL_SAFETY,
      (drivetrain.intervalVelocityLimits[index] ?? Number.POSITIVE_INFINITY) * NUMERICAL_SAFETY,
      curvatureVelocityLimits[index],
      intervalCurvatureVelocityLimits[index - 1] ?? Number.POSITIVE_INFINITY,
      intervalCurvatureVelocityLimits[index] ?? Number.POSITIVE_INFINITY,
      angularIntervalVelocityLimits[index - 1] ?? Number.POSITIVE_INFINITY,
      angularIntervalVelocityLimits[index] ?? Number.POSITIVE_INFINITY,
      state.points[index].stop ? 0 : Number.POSITIVE_INFINITY,
    )),
    // Keep the rounded trajectory inside the independently checked authored
    // envelope without weakening the limits used by final validation.
    accelerationLimits: profile.intervals.map((limits) => limits.acceleration * NUMERICAL_SAFETY),
    decelerationLimits: profile.intervals.map((limits) => limits.deceleration * NUMERICAL_SAFETY),
    freeSpeeds: profile.intervals.map((limits) => limits.freeSpeed),
    motorAccelerationLimits: profile.intervals.map((limits) => limits.motorAcceleration),
    accelerationConstraints: drivetrain.intervalAccelerationConstraints,
    scalarAccelerationConstraints: angularAccelerationConstraints,
    startVelocity,
    goalVelocity,
  };
}

export function countLinearConstraintViolations(input: PlannerInput, samples: readonly TrajectorySample[]): number {
  const profile = buildLinearConstraintProfile(input, samples);
  let violations = 0;
  samples.forEach((sample, index) => {
    const pointVelocityTolerance = Math.max(1e-4, profile.points[index].velocity * 1e-4);
    if (sample.velocityMps > profile.points[index].velocity + pointVelocityTolerance) violations += 1;
    if (index === 0) return;

    const previous = samples[index - 1];
    const interval = profile.intervals[index - 1];
    const intervalVelocityTolerance = Math.max(1e-4, interval.velocity * 1e-4);
    if (Math.max(previous.velocityMps, sample.velocityMps) > interval.velocity + intervalVelocityTolerance) violations += 1;
    const distance = sample.s - previous.s;
    if (distance <= EPSILON) return;
    const acceleration = (sample.velocityMps ** 2 - previous.velocityMps ** 2) / (2 * distance);
    const limit = acceleration >= 0
      ? Math.min(
          interval.acceleration,
          interval.motorAcceleration * Math.max(0, Math.min(
            1,
            1 - Math.max(previous.velocityMps, sample.velocityMps) / interval.freeSpeed,
          )),
        )
      : interval.deceleration;
    if (Math.abs(acceleration) > limit + Math.max(1e-3, limit * 1e-3)) violations += 1;
  });
  return violations;
}
