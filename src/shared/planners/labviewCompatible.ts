import {
  buildLabviewQuinticSpline,
  sampleLabviewQuinticAtDistance,
  type LabviewBezierWaypoint,
} from "../math/labviewBezier";
import { LABVIEW_BDX_MAX_TRAJECTORY_POINTS } from "../export/labviewBdxReader";
import {
  generateLabviewClothoidPath,
  type LabviewClothoidPoint,
} from "../math/labviewClothoid";
import type {
  BdxMarker,
  ConstraintRange,
  PathDoc,
  PlannerInput,
  PlannerResult,
  TrajectoryPlanner,
  TrajectoryPlannerId,
  TrajectorySample,
  ValidationIssue,
  Waypoint,
} from "../types";
import {
  headingTransitionGoals,
  headingTransitionWindows,
  segmentHeadingLaws,
  smoothHeadingTransitions,
  type HeadingTransitionWindow,
} from "./headingTransitions";

const DEFAULT_SAMPLE_PERIOD_S = 0.02;
const DEFAULT_MIN_TURN_RADIUS_M = 0.5;
const EPSILON = 1e-9;

interface GeometryPoint {
  x: number;
  y: number;
  s: number;
  heading: number;
  curvature: number;
}

interface TimelinePoint extends GeometryPoint {
  t: number;
  velocity: number;
}

interface DraftSample extends GeometryPoint {
  t: number;
  velocity: number;
  robotHeading: number;
  rotationBreak?: boolean;
}

type NormalizedRange = ConstraintRange & { f0: number; f1: number };

interface PlanningTimeline {
  points: TimelinePoint[];
  stops: Map<number, number>;
  rotationBreaks: Set<number>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** DC-motor torque falls linearly to zero at the configured free speed. */
function motorAccelerationLimit(zeroSpeedAcceleration: number, velocity: number, maxRobotVelocity: number): number {
  if (!(maxRobotVelocity > EPSILON)) return 0;
  return zeroSpeedAcceleration * clamp(1 - Math.abs(velocity) / maxRobotVelocity, 0, 1);
}

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

function unwrapFrom(previous: number, next: number): number {
  return previous + wrapRadians(next - previous);
}

function finiteSamplePeriod(path: PathDoc): number {
  const configured = path.labview?.samplePeriodS;
  return Number.isFinite(configured) && configured! >= 0.001 && configured! <= 0.1
    ? configured!
    : DEFAULT_SAMPLE_PERIOD_S;
}

function automaticBezierWaypoints(waypoints: readonly Waypoint[]): LabviewBezierWaypoint[] {
  return waypoints.map((waypoint, index) => {
    const current: LabviewBezierWaypoint = { x: waypoint.x, y: waypoint.y };
    if (index === 0) {
      const chord = Math.hypot(waypoints[1].x - waypoint.x, waypoints[1].y - waypoint.y);
      const angle = waypoint.theta * Math.PI / 180;
      current.nextC = { x: waypoint.x + Math.cos(angle) * chord / 5, y: waypoint.y + Math.sin(angle) * chord / 5 };
    } else if (index === waypoints.length - 1) {
      const chord = Math.hypot(waypoint.x - waypoints[index - 1].x, waypoint.y - waypoints[index - 1].y);
      const angle = waypoint.theta * Math.PI / 180;
      current.prevC = { x: waypoint.x - Math.cos(angle) * chord / 5, y: waypoint.y - Math.sin(angle) * chord / 5 };
    }
    return current;
  });
}

function appendBezierPiece(output: GeometryPoint[], waypoints: readonly Waypoint[], automatic: boolean): void {
  const bezierWaypoints: LabviewBezierWaypoint[] = automatic
    ? automaticBezierWaypoints(waypoints)
    : waypoints.map((waypoint) => ({
      x: waypoint.x,
      y: waypoint.y,
      prevC: waypoint.prevC,
      nextC: waypoint.nextC,
    }));
  const spline = buildLabviewQuinticSpline(bezierWaypoints);
  const offset = output.at(-1)?.s ?? 0;
  const distances = [0];
  spline.segmentLengths.forEach((length, segmentIndex) => {
    const start = spline.cumulativeLengths[segmentIndex];
    for (let part = 1; part <= 240; part += 1) distances.push(start + length * part / 240);
  });
  distances.forEach((distance, index) => {
    if (output.length > 0 && index === 0) return;
    const sample = sampleLabviewQuinticAtDistance(spline, distance);
    output.push({
      x: sample.x,
      y: sample.y,
      s: offset + sample.distance,
      heading: sample.headingRad,
      curvature: sample.curvature,
    });
  });
}

function bezierGeometry(path: PathDoc): GeometryPoint[] {
  const count = (path.waypoints.length - 1) * 240 + 1;
  if (count > LABVIEW_BDX_MAX_TRAJECTORY_POINTS) {
    throw new Error(`Path "${path.name}" requires ${count} Bezier geometry points, exceeding the compatibility limit of ${LABVIEW_BDX_MAX_TRAJECTORY_POINTS}`);
  }
  const output: GeometryPoint[] = [];
  let start = 0;
  for (let index = 1; index < path.waypoints.length; index += 1) {
    const isBoundary = path.waypoints[index].stop === true || index === path.waypoints.length - 1;
    if (!isBoundary) continue;
    appendBezierPiece(output, path.waypoints.slice(start, index + 1), path.labview?.bezierTangentMode === "automatic");
    start = index;
  }
  return output;
}

function appendClothoidPiece(output: GeometryPoint[], piece: readonly LabviewClothoidPoint[]): void {
  const offset = output.at(-1)?.s ?? 0;
  piece.forEach((point, index) => {
    if (output.length > 0 && index === 0) return;
    output.push({
      x: point.x,
      y: point.y,
      s: offset + point.s,
      heading: point.heading,
      curvature: point.curvature,
    });
  });
}

function clothoidGeometry(path: PathDoc): GeometryPoint[] {
  const radius = path.labview?.minTurnRadiusM ?? DEFAULT_MIN_TURN_RADIUS_M;
  const output: GeometryPoint[] = [];
  let start = 0;
  for (let index = 1; index < path.waypoints.length; index += 1) {
    const isBoundary = path.waypoints[index].stop === true || index === path.waypoints.length - 1;
    if (!isBoundary) continue;
    appendClothoidPiece(output, generateLabviewClothoidPath(path.waypoints.slice(start, index + 1), radius));
    start = index;
  }
  return output;
}

function densifyGeometry(points: readonly GeometryPoint[], maximumSpacing = 0.02): GeometryPoint[] {
  const output: GeometryPoint[] = [{ ...points[0], s: 0 }];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const distance = Math.hypot(after.x - before.x, after.y - before.y);
    const count = Math.max(1, Math.ceil(distance / maximumSpacing));
    for (let part = 1; part <= count; part += 1) {
      const ratio = part / count;
      const previous = output.at(-1)!;
      const point = {
        x: before.x + (after.x - before.x) * ratio,
        y: before.y + (after.y - before.y) * ratio,
        heading: before.heading + wrapRadians(after.heading - before.heading) * ratio,
        curvature: before.curvature + (after.curvature - before.curvature) * ratio,
      };
      output.push({ ...point, s: previous.s + Math.hypot(point.x - previous.x, point.y - previous.y) });
    }
  }
  return output;
}

function nearestGeometryIndices(path: PathDoc, geometry: readonly { x: number; y: number; s: number }[]): number[] {
  let minimumIndex = 0;
  return path.waypoints.map((waypoint) => {
    let bestIndex = minimumIndex;
    let bestDistance = Infinity;
    for (let index = minimumIndex; index < geometry.length; index += 1) {
      const point = geometry[index];
      const distance = (point.x - waypoint.x) ** 2 + (point.y - waypoint.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    minimumIndex = bestIndex;
    return bestIndex;
  });
}

function rangeFractions(path: PathDoc, totalDistance: number, waypointIndices: readonly number[], geometry: readonly { s: number }[]): NormalizedRange[] {
  return path.ranges.map((range) => {
    let f0 = range.f0;
    let f1 = range.f1;
    if (range.anchor === "dist") {
      f0 = (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON);
      f1 = (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON);
    } else if (range.anchor === "wp") {
      const first = clamp(Math.round(range.w0 ?? 0), 0, waypointIndices.length - 1);
      const last = clamp(Math.round(range.w1 ?? waypointIndices.length - 1), 0, waypointIndices.length - 1);
      const localFraction = (segment: number, local: number | undefined) => {
        if (local == null) return geometry[waypointIndices[segment]].s / Math.max(totalDistance, EPSILON);
        const start = clamp(segment, 0, waypointIndices.length - 2);
        const startDistance = geometry[waypointIndices[start]].s;
        const endDistance = geometry[waypointIndices[start + 1]].s;
        return (startDistance + (endDistance - startDistance) * clamp(local, 0, 1)) / Math.max(totalDistance, EPSILON);
      };
      f0 = localFraction(first, range.t0);
      f1 = localFraction(last, range.t1);
    }
    return { ...range, f0: clamp(Math.min(f0, f1), 0, 1), f1: clamp(Math.max(f0, f1), 0, 1) };
  });
}

function translationPriorityForInterval(
  ranges: readonly NormalizedRange[],
  transitions: readonly HeadingTransitionWindow[],
  before: number,
  after: number,
): boolean {
  const start = Math.min(before, after);
  const end = Math.max(before, after);
  const overlaps = (candidateStart: number, candidateEnd: number) => (
    Math.min(end, candidateEnd) - Math.max(start, candidateStart) >= -EPSILON
  );
  const activeRanges = ranges.filter((range) => overlaps(range.f0, range.f1));
  const activeTransitions = transitions.filter((transition) => overlaps(transition.start, transition.end));
  return activeRanges.length + activeTransitions.length > 0
    && activeRanges.every((range) => range.rotationPriority === "translation")
    && activeTransitions.every((transition) => transition.rotationPriority === "translation");
}

function transitionWindowsForSamples(path: PathDoc, samples: readonly { x: number; y: number; s: number }[]): HeadingTransitionWindow[] {
  const totalDistance = samples.at(-1)?.s ?? 0;
  const waypointIndices = nearestGeometryIndices(path, samples);
  const fractions = waypointIndices.map((index) => (samples[index]?.s ?? 0) / Math.max(totalDistance, EPSILON));
  const laws = segmentHeadingLaws(path, false);
  const breaks = path.waypoints.slice(0, -1).map((waypoint) => Boolean(waypoint.turnInPlace));
  return headingTransitionWindows(path.waypoints, laws, breaks, fractions, totalDistance);
}

function headingTargets(path: PathDoc, geometry: readonly GeometryPoint[], waypointIndices: readonly number[], includeTargets: boolean): Array<{ f: number; heading: number }> {
  const totalDistance = geometry.at(-1)?.s ?? 0;
  const entries: Array<{ f: number; heading: number }> = [];
  path.waypoints.forEach((waypoint, index) => {
    const endpoint = index === 0 || index === path.waypoints.length - 1;
    if (endpoint || waypoint.thetaOn) {
      entries.push({ f: geometry[waypointIndices[index]].s / Math.max(totalDistance, EPSILON), heading: waypoint.theta * Math.PI / 180 });
    }
  });
  if (includeTargets) {
    path.targets.forEach((target) => {
      const fraction = target.anchor === "dist"
        ? (target.d ?? target.f * totalDistance) / Math.max(totalDistance, EPSILON)
        : target.f;
      entries.push({ f: clamp(fraction, 0, 1), heading: target.deg * Math.PI / 180 });
    });
  }
  entries.sort((a, b) => a.f - b.f);
  if (entries.length === 0) entries.push({ f: 0, heading: 0 }, { f: 1, heading: 0 });
  const deduplicated: Array<{ f: number; heading: number }> = [];
  entries.forEach((entry) => {
    const previous = deduplicated.at(-1);
    const heading = previous ? unwrapFrom(previous.heading, entry.heading) : entry.heading;
    if (previous && Math.abs(previous.f - entry.f) < EPSILON) previous.heading = heading;
    else deduplicated.push({ f: entry.f, heading });
  });
  return deduplicated;
}

function segmentAtGeometryIndex(index: number, waypointIndices: readonly number[]): number {
  let segment = 0;
  while (segment < waypointIndices.length - 2 && index >= waypointIndices[segment + 1]) segment += 1;
  return segment;
}

function headingAtFraction(entries: readonly { f: number; heading: number }[], fraction: number): number {
  if (fraction <= entries[0].f) return entries[0].heading;
  const last = entries[entries.length - 1];
  if (fraction >= last.f) return last.heading;
  let index = 1;
  while (entries[index].f < fraction) index += 1;
  const before = entries[index - 1];
  const after = entries[index];
  const ratio = (fraction - before.f) / Math.max(EPSILON, after.f - before.f);
  const smooth = ratio * ratio * (3 - 2 * ratio);
  return before.heading + (after.heading - before.heading) * smooth;
}

function buildTimeline(input: PlannerInput, geometry: readonly GeometryPoint[]): PlanningTimeline {
  const { path, robot } = input;
  const totalDistance = geometry.at(-1)?.s ?? 0;
  const waypointIndices = nearestGeometryIndices(path, geometry);
  const ranges = rangeFractions(path, totalDistance, waypointIndices, geometry);
  const manualHeadings = headingTargets(path, geometry, waypointIndices, false);
  const targetHeadings = headingTargets(path, geometry, waypointIndices, true);
  const rawRobotHeadings: number[] = [];
  const segmentModes = path.waypoints.slice(0, -1).map((waypoint) => robot.drive === "tank"
    ? "tangent"
    : waypoint.segmentHeadingMode ?? path.headingMode ?? "targets");
  geometry.forEach((point, index) => {
    const segment = segmentAtGeometryIndex(index, waypointIndices);
    const headingMode = segmentModes[segment];
    const fraction = point.s / Math.max(totalDistance, EPSILON);
    let baseHeading: number;
    if (headingMode === "lookAt") {
      const target = path.waypoints[segment]?.segmentLookAt;
      const dx = target ? target.x - point.x : 0;
      const dy = target ? target.y - point.y : 0;
      baseHeading = Math.hypot(dx, dy) > EPSILON
        ? Math.atan2(dy, dx)
        : (rawRobotHeadings.at(-1) ?? point.heading);
    } else {
      baseHeading = headingMode === "tangent"
        ? point.heading
        : headingAtFraction(headingMode === "targets" ? targetHeadings : manualHeadings, fraction);
    }
    rawRobotHeadings.push(baseHeading + (path.driveBackward ? Math.PI : 0));
  });
  const segmentLaws = path.waypoints.slice(0, -1).map((waypoint, segment) => {
    if (segmentModes[segment] !== "lookAt") return segmentModes[segment];
    return `lookAt:${waypoint.segmentLookAt?.x ?? ""}:${waypoint.segmentLookAt?.y ?? ""}`;
  });
  const transitionBreaks = path.waypoints.slice(0, -1).map((waypoint) => Boolean(waypoint.turnInPlace));
  const backwardOffset = path.driveBackward ? Math.PI : 0;
  const transitionGoals = headingTransitionGoals(
    segmentLaws,
    transitionBreaks,
    waypointIndices,
    geometry,
    {
      manual: manualHeadings.map((anchor) => ({ f: anchor.f, heading: anchor.heading + backwardOffset })),
