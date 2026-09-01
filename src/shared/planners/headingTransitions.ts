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
    // The outgoing heading law owns the path beginning at its waypoint. Legacy
    // priority metadata is ignored; translation and heading are planned as one
    // coupled motion.
    const start = Math.max(previousEnd, boundary);
    const end = clamp(waypointFractions[segment + 1] ?? boundary, boundary, 1);
    // The spline seed constrains heading first; the coupled planner pursues the
    // heading anchor while retiming translation. Neither reads legacy UI policy.
    windows.push({ rotationPriority, waypointIndex: segment, start, end });
    previousEnd = end;
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
  points: readonly { s: number; heading?: number }[],
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
    const anchor = firstHeadingAnchorInDistanceRange(
      anchorsByLaw[law], totalDistanceM, boundaryDistance, spanEndDistance,
    );
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
  points: readonly { s: number; heading?: number }[],
  waypoints: readonly Waypoint[],
  transitionGoals: readonly HeadingTransitionGoal[] = [],
): number[] {
  if (rawHeadings.length === 0) return [];
  const unwrappedRaw = [rawHeadings[0]];
  for (let index = 1; index < rawHeadings.length; index += 1) {
    unwrappedRaw.push(unwrapFrom(unwrappedRaw[index - 1], rawHeadings[index]));
  }
  const headings = [...unwrappedRaw];
  smoothSwerveTangentJoints(headings, segmentLaws, transitionBreaks, waypointIndices, points);
  const protectedAnchorIndices = new Set<number>();

  for (let segment = 1; segment < segmentLaws.length; segment += 1) {
    if (segmentLaws[segment] === segmentLaws[segment - 1] || transitionBreaks[segment]) continue;
    const boundaryIndex = clamp(waypointIndices[segment], 1, headings.length - 1);
    const nextBoundary = clamp(waypointIndices[segment + 1], boundaryIndex, headings.length - 1);
    let outgoingStart = Math.min(boundaryIndex + 1, nextBoundary);
    while (outgoingStart < nextBoundary && points[outgoingStart].s - points[boundaryIndex].s <= EPSILON) outgoingStart += 1;

    let protectedBefore = -1;
    protectedAnchorIndices.forEach((index) => {
      if (index <= boundaryIndex) protectedBefore = Math.max(protectedBefore, index);
    });
    const boundaryProtected = protectedBefore === boundaryIndex;
    const sampledIncomingTangent = points[boundaryIndex].heading;
    const incomingWaypoint = waypoints[segment];
    const incomingLawHasWaypointAnchor = incomingWaypoint?.thetaOn
      && (segmentLaws[segment - 1] === "manual" || segmentLaws[segment - 1] === "targets");
    const incoming = boundaryProtected
      ? headings[boundaryIndex]
      : incomingLawHasWaypointAnchor
        ? unwrapFrom(headings[boundaryIndex - 1], incomingWaypoint.theta * (Math.PI / 180))
      : segmentLaws[segment - 1] === "tangent" && Number.isFinite(sampledIncomingTangent)
        ? unwrapFrom(headings[boundaryIndex - 1], sampledIncomingTangent!)
        : headings[boundaryIndex - 1];

    const transitionGoal = transitionGoals.find((goal) => goal.segmentIndex === segment);
    if (transitionGoal) {
      const startIndex = boundaryIndex;
      let anchorIndex = boundaryIndex;
      while (anchorIndex < transitionGoal.spanEndIndex && points[anchorIndex].s < transitionGoal.distanceM - EPSILON) anchorIndex += 1;
      const goalIndex = anchorIndex;

      const startHeading = incoming;
      // Off-grid targets join the outgoing law at the next sample; only exact
      // sampled anchors may replace that sample's heading with the target angle.
      const sampledGoal = Math.abs(points[goalIndex].s - transitionGoal.distanceM) <= EPSILON
        ? transitionGoal.heading
        : unwrappedRaw[goalIndex];
      const goalHeading = unwrapFrom(startHeading, sampledGoal);
      const startDistance = points[startIndex].s;
      const endDistance = points[goalIndex].s;
      const span = endDistance - startDistance;
      const secant = span > EPSILON ? (goalHeading - startHeading) / span : 0;
      const limitSlope = (slope: number) => {
        if (Math.abs(secant) <= EPSILON || slope * secant <= 0) return 0;
        return Math.sign(secant) * Math.min(Math.abs(slope), Math.abs(secant) * 3);
      };
      const startDistanceDelta = startIndex > 0 ? points[startIndex].s - points[startIndex - 1].s : 0;
      // Preserve the incoming angular velocity law at the waypoint. If it is
      // initially moving away from the next anchor, the physically continuous
      // solution briefly overshoots and reverses; zeroing that slope creates an
      // infinite angular-acceleration corner and forces translation to stop.
      const startSlope = startDistanceDelta > EPSILON
        ? (startHeading - headings[startIndex - 1]) / startDistanceDelta
        : secant;
      const endDistanceDelta = goalIndex < transitionGoal.spanEndIndex ? points[goalIndex + 1].s - points[goalIndex].s : 0;
      const endSlope = endDistanceDelta > EPSILON
        ? limitSlope((unwrappedRaw[goalIndex + 1] - unwrappedRaw[goalIndex])
          / endDistanceDelta)
        : secant;
      for (let index = startIndex; index <= goalIndex; index += 1) {
        const progress = span > EPSILON
          ? (points[index].s - startDistance) / span
          : 1;
        const t = clamp(progress, 0, 1);
        const t2 = t * t;
        const t3 = t2 * t;
        headings[index] = (2 * t3 - 3 * t2 + 1) * startHeading
          + (t3 - 2 * t2 + t) * span * startSlope
          + (-2 * t3 + 3 * t2) * goalHeading
          + (t3 - t2) * span * endSlope;
      }

      if (goalIndex < transitionGoal.spanEndIndex) {
        const nextIndex = goalIndex + 1;
        const branchOffset = unwrapFrom(goalHeading, rawHeadings[nextIndex]) - unwrappedRaw[nextIndex];
        for (let index = nextIndex; index <= transitionGoal.spanEndIndex; index += 1) {
          headings[index] = unwrappedRaw[index] + branchOffset;
        }
      }
      protectedAnchorIndices.add(goalIndex);
      continue;
    }

    const outgoingLaw = segmentLaws[segment];
    if (outgoingLaw === "tangent" || outgoingLaw.startsWith("lookAt:")) {
      // Tangent and LookAt are continuous heading laws, not a single terminal
      // angle. The incoming law owns the waypoint sample; every moving sample
      // after it follows the outgoing law on the nearest unwrapped branch.
      headings[boundaryIndex] = incoming;
      let previous = incoming;
      for (let index = boundaryIndex + 1; index <= nextBoundary; index += 1) {
        headings[index] = unwrapFrom(previous, rawHeadings[index]);
        previous = headings[index];
      }
      continue;
    }

    const outgoing = unwrapFrom(incoming, rawHeadings[outgoingStart]);
    const boundaryHeading = incoming;
    const afterDistance = Math.max(0, points[nextBoundary].s - points[boundaryIndex].s);
    let previous = boundaryHeading;
    const afterStartIndex = boundaryProtected ? boundaryIndex + 1 : boundaryIndex;
    for (let index = afterStartIndex; index <= nextBoundary; index += 1) {
      const base = unwrapFrom(previous, rawHeadings[index === boundaryIndex ? outgoingStart : index]);
      const progress = afterDistance > EPSILON ? (points[index].s - points[boundaryIndex].s) / afterDistance : 1;
      headings[index] = base + (boundaryHeading - outgoing) * (1 - smootherStep(progress));
      previous = headings[index];
    }
  }
  return headings;
}
