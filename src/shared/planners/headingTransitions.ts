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
 * Finds the first authored heading anchor after a transition into Manual or
 * Targets mode. Those laws are interpolated path-wide, including while another
 * law is active; acquiring their hidden boundary value can therefore point the
 * robot past the next real anchor before reversing back to it.
 */
export function headingTransitionGoals(
  segmentLaws: readonly string[],
  transitionBreaks: readonly boolean[],
  waypointIndices: readonly number[],
  points: readonly { s: number }[],
  anchorsByLaw: {
    manual: readonly HeadingLawAnchor[];
    targets: readonly HeadingLawAnchor[];
  },
): HeadingTransitionGoal[] {
  const totalDistanceM = points.at(-1)?.s ?? 0;
  const goals: HeadingTransitionGoal[] = [];
  for (let segment = 1; segment < segmentLaws.length; segment += 1) {
    const law = segmentLaws[segment];
    if ((law !== "manual" && law !== "targets")
      || segmentLaws[segment - 1] === law
      || transitionBreaks[segment]) continue;

    let spanEndSegment = segment;
    while (spanEndSegment + 1 < segmentLaws.length
      && segmentLaws[spanEndSegment + 1] === law
      && !transitionBreaks[spanEndSegment + 1]) spanEndSegment += 1;

    const boundaryIndex = clamp(waypointIndices[segment], 0, Math.max(0, points.length - 1));
    const spanEndIndex = clamp(waypointIndices[spanEndSegment + 1], boundaryIndex, Math.max(boundaryIndex, points.length - 1));
    const boundaryDistance = points[boundaryIndex]?.s ?? 0;
    const spanEndDistance = points[spanEndIndex]?.s ?? boundaryDistance;
    const anchor = anchorsByLaw[law].find((candidate) => {
      const distance = clamp(candidate.f, 0, 1) * totalDistanceM;
      return distance >= boundaryDistance - EPSILON && distance <= spanEndDistance + EPSILON;
    });
    if (!anchor) continue;
    goals.push({
      segmentIndex: segment,
      distanceM: Math.max(boundaryDistance, clamp(anchor.f, 0, 1) * totalDistanceM),
      heading: anchor.heading,
      spanEndIndex,
    });
  }
  return goals;
}

export function smoothHeadingTransitions(
  rawHeadings: readonly number[],
  segmentLaws: readonly string[],
  transitionBreaks: readonly boolean[],
  waypointIndices: readonly number[],
  points: readonly { s: number }[],
  waypoints: readonly Waypoint[],
  transitionGoals: readonly HeadingTransitionGoal[] = [],
): number[] {
  if (rawHeadings.length === 0) return [];
  const unwrappedRaw = [rawHeadings[0]];
  for (let index = 1; index < rawHeadings.length; index += 1) {
    unwrappedRaw.push(unwrapFrom(unwrappedRaw[index - 1], rawHeadings[index]));
  }
  const headings = [...unwrappedRaw];
  const protectedAnchorIndices = new Set<number>();

  for (let segment = 1; segment < segmentLaws.length; segment += 1) {
    if (segmentLaws[segment] === segmentLaws[segment - 1] || transitionBreaks[segment]) continue;
    const boundaryIndex = clamp(waypointIndices[segment], 1, headings.length - 1);
    const previousBoundary = clamp(waypointIndices[segment - 1], 0, boundaryIndex - 1);
    const nextBoundary = clamp(waypointIndices[segment + 1], boundaryIndex, headings.length - 1);
    let outgoingStart = Math.min(boundaryIndex + 1, nextBoundary);
    while (outgoingStart < nextBoundary && points[outgoingStart].s - points[boundaryIndex].s <= EPSILON) outgoingStart += 1;

    const policy = resolveHeadingTransition(waypoints[segment]?.headingTransition);
    let protectedBefore = -1;
    protectedAnchorIndices.forEach((index) => {
      if (index <= boundaryIndex) protectedBefore = Math.max(protectedBefore, index);
    });
    const boundaryProtected = protectedBefore === boundaryIndex;
    const authoredBeforeShare = policy.placement === "before" ? 1 : policy.placement === "split" ? 0.5 : 0;
    const beforeShare = boundaryProtected ? 0 : authoredBeforeShare;
    const afterShare = 1 - beforeShare;
    const incoming = boundaryProtected ? headings[boundaryIndex] : headings[boundaryIndex - 1];

    const transitionGoal = transitionGoals.find((goal) => goal.segmentIndex === segment);
    if (transitionGoal) {
      const boundaryDistance = points[boundaryIndex].s;
      const beforeDistance = Math.min(
        policy.distanceM * beforeShare,
        Math.max(0, boundaryDistance - points[previousBoundary].s),
      );
