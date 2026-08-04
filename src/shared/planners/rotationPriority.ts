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
