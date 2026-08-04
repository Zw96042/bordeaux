import type { HeadingTransition, PathDoc, Waypoint } from "../types";

const EPSILON = 1e-9;
export const DEFAULT_HEADING_TRANSITION_DISTANCE_M = 0.75;

export interface ResolvedHeadingTransition {
  placement: "before" | "split" | "after";
  rotationPriority: "heading" | "translation";
  distanceM: number;
}

export interface HeadingTransitionWindow extends ResolvedHeadingTransition {
  waypointIndex: number;
  start: number;
  end: number;
}

export interface HeadingLawAnchor {
  f: number;
  heading: number;
}

export interface HeadingTransitionGoal {
  segmentIndex: number;
  distanceM: number;
  heading: number;
  spanEndIndex: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function unwrapFrom(previous: number, next: number): number {
  return previous + wrapRadians(next - previous);
}

function smootherStep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function resolveHeadingTransition(value?: HeadingTransition): ResolvedHeadingTransition {
  return {
    placement: value?.placement ?? "after",
    rotationPriority: value?.rotationPriority ?? "heading",
    distanceM: value?.distanceM ?? DEFAULT_HEADING_TRANSITION_DISTANCE_M,
  };
}

export function segmentHeadingLaws(path: PathDoc, tankDrive: boolean): string[] {
  return path.waypoints.slice(0, -1).map((waypoint) => {
    const mode = tankDrive ? "tangent" : waypoint.segmentHeadingMode ?? path.headingMode ?? "targets";
    if (mode !== "lookAt") return mode;
    return `lookAt:${waypoint.segmentLookAt?.x ?? ""}:${waypoint.segmentLookAt?.y ?? ""}`;
  });
}

export function headingTransitionWindows(
  waypoints: readonly Waypoint[],
  segmentLaws: readonly string[],
  transitionBreaks: readonly boolean[],
  waypointFractions: readonly number[],
  totalDistanceM: number,
): HeadingTransitionWindow[] {
  const total = Math.max(totalDistanceM, EPSILON);
  const windows: HeadingTransitionWindow[] = [];
  for (let segment = 1; segment < segmentLaws.length; segment += 1) {
    if (segmentLaws[segment] === segmentLaws[segment - 1] || transitionBreaks[segment]) continue;
    const policy = resolveHeadingTransition(waypoints[segment]?.headingTransition);
    const boundary = clamp(waypointFractions[segment] ?? 0, 0, 1);
    const previousLength = Math.max(0, boundary - clamp(waypointFractions[segment - 1] ?? boundary, 0, 1));
    const nextLength = Math.max(0, clamp(waypointFractions[segment + 1] ?? boundary, 0, 1) - boundary);
    const beforeShare = policy.placement === "before" ? 1 : policy.placement === "split" ? 0.5 : 0;
    const afterShare = 1 - beforeShare;
    const before = Math.min(previousLength, policy.distanceM * beforeShare / total);
    const after = Math.min(nextLength, policy.distanceM * afterShare / total);
    windows.push({ ...policy, waypointIndex: segment, start: boundary - before, end: boundary + after });
  }
  return windows;
}

/**
