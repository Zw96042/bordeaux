import { LABVIEW_BDX_MAX_TRAJECTORY_POINTS } from "../export/labviewBdxReader";
import { PM } from "../math/pm";
import type { ConstraintRange, PathDoc, PlannerResult, RobotConfig, TrajectorySample } from "../types";

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function directedDelta(start: number, end: number, direction = "shortest"): number {
  let delta = wrapRadians(end - start);
  if (Math.abs(delta) < EPSILON) return 0;
  if (direction === "clockwise" && delta > 0) delta -= Math.PI * 2;
  if (direction === "counterclockwise" && delta < 0) delta += Math.PI * 2;
  return delta;
}

function activeAngularLimits(path: PathDoc, fraction: number, waypointIndex: number, totalDistance: number): { velocity: number; acceleration: number; jerk: number } {
  let velocity = path.constraints.maxAngVel * DEG;
  let acceleration = Math.min(path.constraints.maxAngAccel, path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * DEG;
  const jerk = (path.constraints.maxAngJerk ?? 0) * DEG;
  (path.ranges ?? []).forEach((range: ConstraintRange) => {
    let active: boolean;
    if (range.anchor === "wp") {
      const start = (range.w0 ?? 0) + (range.t0 ?? 0);
      const end = (range.w1 ?? path.waypoints.length - 1) + (range.t1 ?? 0);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      active = waypointIndex >= lo - EPSILON && waypointIndex <= hi + EPSILON;
    } else {
      const first = range.anchor === "dist" ? (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f0;
      const last = range.anchor === "dist" ? (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f1;
      const lo = Math.min(first, last), hi = Math.max(first, last);
      active = fraction >= lo - EPSILON && fraction <= hi + EPSILON;
    }
    if (active) {
      velocity = Math.min(velocity, range.maxAngVel * DEG);
      acceleration = Math.min(acceleration, range.maxAngAccel * DEG);
    }
  });
  return { velocity: Math.max(velocity, EPSILON), acceleration: Math.max(acceleration, EPSILON), jerk };
}

function activeLinearLimits(path: PathDoc, fraction: number, waypointIndex: number, totalDistance: number): { velocity: number; acceleration: number; deceleration: number } {
  let velocity = path.constraints.maxVel;
  let acceleration = path.constraints.maxAccel;
  let deceleration = path.constraints.maxDecel ?? path.constraints.maxAccel;
  (path.ranges ?? []).forEach((range: ConstraintRange) => {
    let active: boolean;
    if (range.anchor === "wp") {
      const start = (range.w0 ?? 0) + (range.t0 ?? 0);
      const end = (range.w1 ?? path.waypoints.length - 1) + (range.t1 ?? 0);
      active = waypointIndex >= Math.min(start, end) - EPSILON && waypointIndex <= Math.max(start, end) + EPSILON;
    } else {
      const first = range.anchor === "dist" ? (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f0;
      const last = range.anchor === "dist" ? (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f1;
      active = fraction >= Math.min(first, last) - EPSILON && fraction <= Math.max(first, last) + EPSILON;
    }
    if (active) {
      velocity = Math.min(velocity, range.maxVel);
      acceleration = Math.min(acceleration, range.maxAccel);
      deceleration = Math.min(deceleration, range.maxDecel ?? range.maxAccel);
    }
  });
  return {
    velocity: Math.max(velocity, EPSILON),
    acceleration: Math.max(acceleration, EPSILON),
    deceleration: Math.max(deceleration, EPSILON),
  };
}

function feasibleJiggleStrokeDuration(requested: number, distance: number, limits: ReturnType<typeof activeLinearLimits>, freeSpeed: number): number {
  const minimum = Math.max(
    requested,
    4 * distance / Math.min(limits.velocity, freeSpeed),
    Math.sqrt(16 * distance / limits.deceleration),
  );
  const feasible = (duration: number) => {
    const peakVelocity = 4 * distance / duration;
    const availableAcceleration = limits.acceleration * Math.max(0, 1 - peakVelocity / freeSpeed);
    return 16 * distance / (duration * duration) <= availableAcceleration + 1e-9;
  };
  if (feasible(minimum)) return minimum;
  let low = minimum, high = minimum;
  while (!feasible(high)) high *= 2;
