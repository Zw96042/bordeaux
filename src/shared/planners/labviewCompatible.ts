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
      targets: targetHeadings.map((anchor) => ({ f: anchor.f, heading: anchor.heading + backwardOffset })),
    },
  );
  const robotHeadings = smoothHeadingTransitions(
    rawRobotHeadings,
    segmentLaws,
    transitionBreaks,
    waypointIndices,
    geometry,
    path.waypoints,
    transitionGoals,
  );
  const waypointFractions = waypointIndices.map((index) => geometry[index].s / Math.max(totalDistance, EPSILON));
  const transitions = headingTransitionWindows(path.waypoints, segmentLaws, transitionBreaks, waypointFractions, totalDistance);

  const globalMaxVelocity = Math.min(path.constraints.maxVel, robot.maxSpeed);
  const velocityCaps = geometry.map((point, index) => {
    let cap = globalMaxVelocity;
    const curvature = Math.abs(point.curvature);
    if (curvature > EPSILON) {
      cap = Math.min(cap, Math.sqrt(path.constraints.maxAccel / curvature));
    }
    const fraction = point.s / Math.max(totalDistance, EPSILON);
    const range = ranges.filter((candidate) => fraction >= candidate.f0 - EPSILON && fraction <= candidate.f1 + EPSILON);
    range.forEach((candidate) => { cap = Math.min(cap, candidate.maxVel); });
    const previousFraction = index > 0 ? geometry[index - 1].s / Math.max(totalDistance, EPSILON) : fraction;
    const translationInterval = index > 0
      && translationPriorityForInterval(ranges, transitions, previousFraction, fraction);
    if (index > 0 && !translationInterval) {
      const ds = Math.max(EPSILON, point.s - geometry[index - 1].s);
      const headingRatePerMeter = Math.abs(robotHeadings[index] - robotHeadings[index - 1]) / ds;
      let angularLimit = path.constraints.maxAngVel * Math.PI / 180;
      range.forEach((candidate) => { angularLimit = Math.min(angularLimit, candidate.maxAngVel * Math.PI / 180); });
      if (headingRatePerMeter > EPSILON) cap = Math.min(cap, angularLimit / headingRatePerMeter);
    }
    return Math.max(0, cap);
  });
  if (ranges.some((range) => range.rotationPriority === "translation") || transitions.some((transition) => transition.rotationPriority === "translation")) {
    const omegaCaps = geometry.map((point, index) => {
      const fraction = point.s / Math.max(totalDistance, EPSILON);
      let limit = path.constraints.maxAngVel * Math.PI / 180;
      ranges.forEach((range) => {
        if (fraction >= range.f0 - EPSILON && fraction <= range.f1 + EPSILON) {
          limit = Math.min(limit, range.maxAngVel * Math.PI / 180);
        }
      });
      if (index > 0 && Math.abs(robotHeadings[index] - robotHeadings[index - 1]) <= EPSILON) return 0;
      return limit;
    });
    const reachableOmega = [...omegaCaps];
    if (path.startVel <= EPSILON) reachableOmega[0] = 0;
    for (let index = 1; index < geometry.length; index += 1) {
      const before = geometry[index - 1].s / Math.max(totalDistance, EPSILON);
      const after = geometry[index].s / Math.max(totalDistance, EPSILON);
      if (translationPriorityForInterval(ranges, transitions, before, after)) continue;
      // Leave headroom for the subsequent fixed-period resampling, whose
      // finite differences otherwise land slightly above the spatial bound.
      let angularAcceleration = path.constraints.maxAngAccel * Math.PI / 180 * 0.6;
      ranges.forEach((range) => {
        if ((before >= range.f0 - EPSILON && before <= range.f1 + EPSILON)
          || (after >= range.f0 - EPSILON && after <= range.f1 + EPSILON)) {
          angularAcceleration = Math.min(angularAcceleration, range.maxAngAccel * Math.PI / 180 * 0.6);
        }
      });
      const headingDelta = Math.abs(robotHeadings[index] - robotHeadings[index - 1]);
      reachableOmega[index] = Math.min(reachableOmega[index], Math.sqrt(Math.max(0, reachableOmega[index - 1] ** 2 + 2 * angularAcceleration * headingDelta)));
    }
    if (path.goalVel <= EPSILON) reachableOmega[reachableOmega.length - 1] = 0;
    for (let index = geometry.length - 2; index >= 0; index -= 1) {
      const before = geometry[index].s / Math.max(totalDistance, EPSILON);
      const after = geometry[index + 1].s / Math.max(totalDistance, EPSILON);
      if (translationPriorityForInterval(ranges, transitions, before, after)) continue;
      let angularDeceleration = (path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * Math.PI / 180 * 0.6;
      ranges.forEach((range) => {
        if ((before >= range.f0 - EPSILON && before <= range.f1 + EPSILON)
          || (after >= range.f0 - EPSILON && after <= range.f1 + EPSILON)) {
          angularDeceleration = Math.min(angularDeceleration, range.maxAngAccel * Math.PI / 180 * 0.6);
        }
      });
      const headingDelta = Math.abs(robotHeadings[index + 1] - robotHeadings[index]);
      reachableOmega[index] = Math.min(reachableOmega[index], Math.sqrt(Math.max(0, reachableOmega[index + 1] ** 2 + 2 * angularDeceleration * headingDelta)));
    }
    for (let index = 1; index < geometry.length; index += 1) {
      const before = geometry[index - 1].s / Math.max(totalDistance, EPSILON);
      const after = geometry[index].s / Math.max(totalDistance, EPSILON);
      if (translationPriorityForInterval(ranges, transitions, before, after)) continue;
      const distance = Math.max(EPSILON, geometry[index].s - geometry[index - 1].s);
      const headingRatePerMeter = Math.abs(robotHeadings[index] - robotHeadings[index - 1]) / distance;
      if (headingRatePerMeter > EPSILON) velocityCaps[index] = Math.min(velocityCaps[index], reachableOmega[index] / headingRatePerMeter);
    }
  }

  const stopIndices = new Map<number, number>();
  path.waypoints.forEach((waypoint, index) => {
    if (waypoint.stop) stopIndices.set(waypointIndices[index], Math.max(0, waypoint.wait ?? 0));
  });
  stopIndices.forEach((_wait, index) => { velocityCaps[index] = 0; });

  const acceleration = geometry.map((point) => {
    const fraction = point.s / Math.max(totalDistance, EPSILON);
    let limit = path.constraints.maxAccel;
    ranges.forEach((range) => { if (fraction >= range.f0 - EPSILON && fraction <= range.f1 + EPSILON) limit = Math.min(limit, range.maxAccel); });
    return limit;
  });
  const deceleration = geometry.map((point) => {
    const fraction = point.s / Math.max(totalDistance, EPSILON);
    let limit = path.constraints.maxDecel || path.constraints.maxAccel;
    ranges.forEach((range) => {
      if (fraction >= range.f0 - EPSILON && fraction <= range.f1 + EPSILON) limit = Math.min(limit, range.maxDecel ?? range.maxAccel);
    });
    return limit;
  });

  const velocity = [...velocityCaps];
  velocity[0] = Math.min(velocity[0], path.waypoints[0].stop ? 0 : path.startVel);
  for (let index = 1; index < velocity.length; index += 1) {
    const ds = Math.max(0, geometry[index].s - geometry[index - 1].s);
    const availableAcceleration = motorAccelerationLimit(acceleration[index - 1], velocity[index - 1], robot.maxSpeed);
    velocity[index] = Math.min(velocity[index], Math.sqrt(Math.max(0, velocity[index - 1] ** 2 + 2 * availableAcceleration * ds)));
  }
  velocity[velocity.length - 1] = Math.min(velocity[velocity.length - 1], path.waypoints.at(-1)!.stop ? 0 : path.goalVel);
  for (let index = velocity.length - 2; index >= 0; index -= 1) {
    const ds = Math.max(0, geometry[index + 1].s - geometry[index].s);
    velocity[index] = Math.min(velocity[index], Math.sqrt(Math.max(0, velocity[index + 1] ** 2 + 2 * deceleration[index + 1] * ds)));
  }

  const timeline: TimelinePoint[] = [{ ...geometry[0], heading: robotHeadings[0], t: 0, velocity: velocity[0] }];
  let time = 0;
  for (let index = 1; index < geometry.length; index += 1) {
    const ds = Math.max(0, geometry[index].s - geometry[index - 1].s);
    const averageVelocity = (velocity[index - 1] + velocity[index]) / 2;
    time += averageVelocity > EPSILON ? ds / averageVelocity : 0;
    timeline.push({ ...geometry[index], heading: robotHeadings[index], t: time, velocity: velocity[index] });
  }
  const expanded: TimelinePoint[] = [];
  const expandedStops = new Map<number, number>();
  const rotationBreaks = new Set<number>();
  const turnsByIndex = new Map<number, Waypoint>();
  path.waypoints.forEach((waypoint, index) => {
    if (waypoint.stop && waypoint.turnInPlace && index < path.waypoints.length - 1) turnsByIndex.set(waypointIndices[index], waypoint);
  });
  timeline.forEach((point, index) => {
    const turn = turnsByIndex.get(index);
    const incoming = turn && index > 0 ? { ...point, heading: timeline[index - 1].heading } : point;
    const expandedIndex = expanded.push(incoming) - 1;
    if (stopIndices.has(index)) expandedStops.set(expandedIndex, stopIndices.get(index)!);
    if (turn) {
      expanded.push({ ...incoming, heading: unwrapFrom(incoming.heading, point.heading) });
      rotationBreaks.add(expandedIndex);
    }
  });
  return { points: expanded, stops: expandedStops, rotationBreaks };
}

function interpolateTimeline(timeline: readonly TimelinePoint[], time: number): TimelinePoint {
  if (time <= 0) return timeline[0];
  const last = timeline[timeline.length - 1];
  if (time >= last.t) return last;
  let low = 1;
  let high = timeline.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (timeline[middle].t < time) low = middle + 1;
    else high = middle;
  }
  const before = timeline[low - 1];
  const after = timeline[low];
  const ratio = (time - before.t) / Math.max(EPSILON, after.t - before.t);
  const lerp = (a: number, b: number) => a + (b - a) * ratio;
  return {
    x: lerp(before.x, after.x),
    y: lerp(before.y, after.y),
    s: lerp(before.s, after.s),
    heading: lerp(before.heading, after.heading),
    curvature: lerp(before.curvature, after.curvature),
    t: time,
    velocity: lerp(before.velocity, after.velocity),
  };
}

function draftSamples(planning: PlanningTimeline, samplePeriod: number, requestedScale: number): DraftSample[] {
  const timeline = planning.points;
  const boundaries = [0, ...[...planning.stops.keys()].filter((index) => index > 0 && index < timeline.length - 1), timeline.length - 1]
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  let tick = 0;
  const startWaitTicks = Math.ceil((planning.stops.get(0) ?? 0) / samplePeriod - EPSILON);
  let estimatedCount = 1 + startWaitTicks;
  for (let section = 1; section < boundaries.length; section += 1) {
    const rawDuration = timeline[boundaries[section]].t - timeline[boundaries[section - 1]].t;
    estimatedCount += Math.max(1, Math.ceil((rawDuration * requestedScale - EPSILON) / samplePeriod));
    estimatedCount += Math.ceil((planning.stops.get(boundaries[section]) ?? 0) / samplePeriod - EPSILON);
  }
  if (estimatedCount > LABVIEW_BDX_MAX_TRAJECTORY_POINTS) {
    throw new Error(`Compatibility timing requires ${estimatedCount} samples, exceeding the LabVIEW .bdx limit of ${LABVIEW_BDX_MAX_TRAJECTORY_POINTS}`);
  }

  const samples: DraftSample[] = [];
  for (let section = 1; section < boundaries.length; section += 1) {
    const startIndex = boundaries[section - 1];
    const endIndex = boundaries[section];
    const rawStart = timeline[startIndex].t;
    const rawDuration = timeline[endIndex].t - rawStart;
    const motionTicks = Math.max(1, Math.ceil((rawDuration * requestedScale - EPSILON) / samplePeriod));
    const sectionScale = rawDuration > EPSILON ? motionTicks * samplePeriod / rawDuration : 1;
    if (samples.length === 0) {
      const point = timeline[startIndex];
      samples.push({ ...point, t: 0, velocity: point.velocity / sectionScale, robotHeading: point.heading });
      for (let waitTick = 0; waitTick < startWaitTicks; waitTick += 1) {
        tick += 1;
        samples.push({ ...samples[0], t: tick * samplePeriod, velocity: 0 });
      }
    }
    for (let part = 1; part <= motionTicks; part += 1) {
      tick += 1;
      const point = interpolateTimeline(timeline, Math.min(rawStart + part * samplePeriod / sectionScale, timeline[endIndex].t));
      samples.push({
        ...point,
        t: tick * samplePeriod,
        velocity: point.velocity / sectionScale,
        robotHeading: point.heading,
        rotationBreak: part === 1 && planning.rotationBreaks.has(startIndex),
      });
    }
    const waitTicks = Math.ceil((planning.stops.get(endIndex) ?? 0) / samplePeriod - EPSILON);
    const stop = samples.at(-1)!;
    for (let waitTick = 0; waitTick < waitTicks; waitTick += 1) {
      tick += 1;
      samples.push({ ...stop, t: tick * samplePeriod, velocity: 0 });
    }
  }
  return samples;
}

function normalizedRangesForSamples(path: PathDoc, samples: readonly { x: number; y: number; s: number }[]): NormalizedRange[] {
  const totalDistance = samples.at(-1)?.s ?? 0;
  return rangeFractions(path, totalDistance, nearestGeometryIndices(path, samples), samples);
}

function activeLimits(path: PathDoc, fraction: number, ranges: readonly NormalizedRange[]) {
  let maxVel = path.constraints.maxVel;
  let maxAccel = path.constraints.maxAccel;
  let maxDecel = path.constraints.maxDecel || path.constraints.maxAccel;
  let maxAngVel = path.constraints.maxAngVel * Math.PI / 180;
  let maxAngAccel = path.constraints.maxAngAccel * Math.PI / 180;
  const maxAngDecel = (path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * Math.PI / 180;
  ranges.forEach((range) => {
    if (fraction < range.f0 - EPSILON || fraction > range.f1 + EPSILON) return;
    maxVel = Math.min(maxVel, range.maxVel);
    maxAccel = Math.min(maxAccel, range.maxAccel);
    maxDecel = Math.min(maxDecel, range.maxDecel ?? range.maxAccel);
    maxAngVel = Math.min(maxAngVel, range.maxAngVel * Math.PI / 180);
    maxAngAccel = Math.min(maxAngAccel, range.maxAngAccel * Math.PI / 180);
  });
  return { maxVel, maxAccel, maxDecel, maxAngVel, maxAngAccel, maxAngDecel: Math.min(maxAngDecel, maxAngAccel) };
}

function intervalLimits(path: PathDoc, before: number, after: number, ranges: readonly NormalizedRange[]) {
  const first = activeLimits(path, before, ranges);
  const second = activeLimits(path, after, ranges);
  return {
    maxVel: Math.min(first.maxVel, second.maxVel),
    maxAccel: Math.min(first.maxAccel, second.maxAccel),
    maxDecel: Math.min(first.maxDecel, second.maxDecel),
    maxAngVel: Math.min(first.maxAngVel, second.maxAngVel),
    maxAngAccel: Math.min(first.maxAngAccel, second.maxAngAccel),
    maxAngDecel: Math.min(first.maxAngDecel, second.maxAngDecel),
  };
}

function requiredTimeScale(samples: readonly DraftSample[], path: PathDoc, robotMaxSpeed: number, samplePeriod: number): number {
  let maxJerk = 0;
  let maxAngularJerk = 0;
  let previousAcceleration = 0;
  let previousOmega = 0;
  let previousAngularAcceleration = 0;
  const totalDistance = samples.at(-1)?.s ?? 0;
  const ranges = normalizedRangesForSamples(path, samples);
  const transitions = transitionWindowsForSamples(path, samples);
  const allowAngularRescale = !ranges.some((range) => range.rotationPriority === "translation")
    && !transitions.some((transition) => transition.rotationPriority === "translation");
  let scale = 1;
  for (let index = 0; index < samples.length; index += 1) {
    const fraction = samples[index].s / Math.max(totalDistance, EPSILON);
    const previousFraction = index === 0 ? fraction : samples[index - 1].s / Math.max(totalDistance, EPSILON);
    const translationInterval = translationPriorityForInterval(ranges, transitions, previousFraction, fraction);
    const limits = index === 0 ? activeLimits(path, fraction, ranges) : intervalLimits(path, previousFraction, fraction, ranges);
    scale = Math.max(scale, Math.abs(samples[index].velocity) / Math.max(EPSILON, limits.maxVel));
    if (index === 0) continue;
    const acceleration = (samples[index].velocity - samples[index - 1].velocity) / samplePeriod;
    const omega = samples[index].rotationBreak ? 0 : (samples[index].robotHeading - samples[index - 1].robotHeading) / samplePeriod;
    const accelerating = Math.abs(samples[index].velocity) >= Math.abs(samples[index - 1].velocity);
    const accelerationLimit = accelerating
      ? motorAccelerationLimit(limits.maxAccel, samples[index - 1].velocity, robotMaxSpeed)
      : limits.maxDecel;
    scale = Math.max(scale, Math.sqrt(Math.abs(acceleration) / Math.max(EPSILON, accelerationLimit)));
    if (allowAngularRescale && !translationInterval) scale = Math.max(scale, Math.abs(omega) / Math.max(EPSILON, limits.maxAngVel));
    if (index > 1) {
      maxJerk = Math.max(maxJerk, Math.abs(acceleration - previousAcceleration) / samplePeriod);
      const angularAcceleration = (omega - previousOmega) / samplePeriod;
      const angularAccelerationLimit = Math.abs(omega) >= Math.abs(previousOmega) ? limits.maxAngAccel : limits.maxAngDecel;
      if (allowAngularRescale && !translationInterval) {
        scale = Math.max(scale, Math.sqrt(Math.abs(angularAcceleration) / Math.max(EPSILON, angularAccelerationLimit)));
        if (index > 2) maxAngularJerk = Math.max(maxAngularJerk, Math.abs(angularAcceleration - previousAngularAcceleration) / samplePeriod);
      }
      previousAngularAcceleration = angularAcceleration;
    }
    previousAcceleration = acceleration;
    previousOmega = omega;
  }

  if ((path.constraints.maxJerk ?? 0) > 0) scale = Math.max(scale, Math.cbrt(maxJerk / path.constraints.maxJerk!));
  if (allowAngularRescale && (path.constraints.maxAngJerk ?? 0) > 0 && maxAngularJerk > 0) {
    scale = Math.max(scale, Math.cbrt(maxAngularJerk / (path.constraints.maxAngJerk! * Math.PI / 180)));
  }
  return Number.isFinite(scale) ? scale : 1;
}

function finalSamples(timeline: PlanningTimeline, path: PathDoc, robotMaxSpeed: number, samplePeriod: number): TrajectorySample[] {
  let requestedScale = 1;
  let draft = draftSamples(timeline, samplePeriod, requestedScale);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const additionalScale = requiredTimeScale(draft, path, robotMaxSpeed, samplePeriod);
    if (additionalScale <= 1.001) break;
    requestedScale *= additionalScale * 1.01;
    draft = draftSamples(timeline, samplePeriod, requestedScale);
  }
  const samples = draft;
  const totalDistance = timeline.points.at(-1)!.s;
  return samples.map((sample, index) => {
    const previous = samples[Math.max(0, index - 1)];
    const acceleration = index === 0 ? 0 : (sample.velocity - previous.velocity) / samplePeriod;
    const angularVelocity = index === 0 || sample.rotationBreak ? 0 : (sample.robotHeading - previous.robotHeading) / samplePeriod;
    return {
      i: index,
      t: sample.t,
      s: sample.s,
      f: totalDistance > EPSILON ? sample.s / totalDistance : 0,
      x: sample.x,
      y: sample.y,
      headingRad: sample.robotHeading,
      velocityMps: sample.velocity,
      accelerationMps2: acceleration,
      angularVelocityRadps: angularVelocity,
      curvatureInvM: sample.curvature,
    };
  });
}

function markersFor(path: PathDoc, samples: readonly TrajectorySample[]): BdxMarker[] {
  const totalDistance = samples.at(-1)?.s ?? 0;
  return path.markers.map((marker, markerIndex) => {
    const fraction = marker.anchor === "dist"
      ? clamp((marker.d ?? marker.f * totalDistance) / Math.max(totalDistance, EPSILON), 0, 1)
      : clamp(marker.f, 0, 1);
    const target = fraction * totalDistance;
    let index = 1;
    while (index < samples.length && samples[index].s < target) index += 1;
    const after = samples[Math.min(index, samples.length - 1)];
    const before = samples[Math.max(0, index - 1)];
    const ratio = (target - before.s) / Math.max(EPSILON, after.s - before.s);
    return {
      id: marker.id ?? `${path.id}:event:${markerIndex}`,
      name: marker.name,
      command: marker.cmd ?? null,
      ...(marker.invocation ? { invocation: marker.invocation } : {}),
      group: marker.group ?? null,
      timeS: before.t + (after.t - before.t) * clamp(ratio, 0, 1),
      fraction,
    };
  });
}

function diagnosticsFor(kind: "bezier" | "clothoid", path: PathDoc, robotMaxSpeed: number, samples: readonly TrajectorySample[]): ValidationIssue[] {
  const diagnostics: ValidationIssue[] = [];
  const waypointIndices = nearestGeometryIndices(path, samples);
  path.waypoints.slice(0, -1).forEach((waypoint, segment) => {
    if (waypoint.segmentHeadingMode !== "lookAt" || !waypoint.segmentLookAt) return;
    let nearest = Infinity;
    for (let index = waypointIndices[segment]; index <= waypointIndices[segment + 1] && index < samples.length; index += 1) {
      nearest = Math.min(nearest, Math.hypot(samples[index].x - waypoint.segmentLookAt.x, samples[index].y - waypoint.segmentLookAt.y));
    }
    if (nearest < 0.05) diagnostics.push({ severity: "error", path: `paths.${path.name}.waypoints[${segment}].segmentLookAt`, message: "Tracked field point lies on the driven segment" });
  });
  if (kind === "clothoid") {
    const requestedRadius = path.labview?.minTurnRadiusM ?? DEFAULT_MIN_TURN_RADIUS_M;
    if (requestedRadius < 0.1) {
      diagnostics.push({ severity: "warning", path: `paths.${path.name}.labview.minTurnRadiusM`, message: "Very small LabVIEW clothoid radius may exceed robot steering limits" });
    }
    const maximumCurvature = Math.max(...samples.map((sample) => Math.abs(sample.curvatureInvM)));
    if (maximumCurvature > 1 / requestedRadius * 1.01) {
      diagnostics.push({ severity: "warning", path: `paths.${path.name}.waypoints`, message: "Adjacent LabVIEW clothoid blends overlap; compatibility mode reduced their effective radius to fit" });
    }
  }
  if ((path.constraints.maxJerk ?? 0) === 0) {
    diagnostics.push({ severity: "warning", path: `paths.${path.name}.constraints.maxJerk`, message: "LabVIEW compatibility timing has no translational jerk cap because Max jerk is zero" });
  }
  const totalDistance = samples.at(-1)?.s ?? 0;
  const ranges = normalizedRangesForSamples(path, samples);
  const transitions = transitionWindowsForSamples(path, samples);
  const finalFollowerOwnsAngularValidation = ranges.some((range) => range.rotationPriority === "translation")
    || transitions.some((transition) => transition.rotationPriority === "translation");
  const angularAcceleration = samples.slice(1).map((sample, index) => {
    const dt = Math.max(EPSILON, sample.t - samples[index].t);
    return (sample.angularVelocityRadps - samples[index].angularVelocityRadps) / dt;
  });
  const violatesVelocityOrAcceleration = samples.some((sample, index) => {
    const fraction = sample.s / Math.max(totalDistance, EPSILON);
    const previousFraction = index === 0 ? fraction : samples[index - 1].s / Math.max(totalDistance, EPSILON);
    const translationInterval = index > 0 && translationPriorityForInterval(ranges, transitions, previousFraction, fraction);
    const limits = index === 0 ? activeLimits(path, fraction, ranges) : intervalLimits(path, previousFraction, fraction, ranges);
    if (Math.abs(sample.velocityMps) > limits.maxVel * 1.02
      || (!finalFollowerOwnsAngularValidation && !translationInterval && Math.abs(sample.angularVelocityRadps) > limits.maxAngVel * 1.02)) return true;
    if (index === 0) return false;
    const accelerating = Math.abs(sample.velocityMps) >= Math.abs(samples[index - 1].velocityMps);
    const linearLimit = accelerating
      ? motorAccelerationLimit(limits.maxAccel, samples[index - 1].velocityMps, robotMaxSpeed)
      : limits.maxDecel;
    if (Math.abs(sample.accelerationMps2) > linearLimit * 1.02) return true;
    if (index === 1) return false;
    const angularLimit = Math.abs(sample.angularVelocityRadps) >= Math.abs(samples[index - 1].angularVelocityRadps)
      ? limits.maxAngAccel
      : limits.maxAngDecel;
    return !finalFollowerOwnsAngularValidation && !translationInterval && Math.abs(angularAcceleration[index - 1]) > angularLimit * 1.02;
  });
  if (violatesVelocityOrAcceleration) {
    diagnostics.push({ severity: "error", path: `paths.${path.name}.constraints`, message: "LabVIEW compatibility timing could not satisfy the configured velocity or acceleration limits" });
  }
  if ((path.constraints.maxJerk ?? 0) > 0 && samples.length > 2) {
    const jerk = samples.slice(2).map((sample, index) => {
      const dt = Math.max(EPSILON, sample.t - samples[index + 1].t);
      return Math.abs(sample.accelerationMps2 - samples[index + 1].accelerationMps2) / dt;
    });
    if (Math.max(...jerk) > path.constraints.maxJerk! * 1.03) {
      diagnostics.push({ severity: "error", path: `paths.${path.name}.constraints.maxJerk`, message: "LabVIEW compatibility timing could not satisfy the configured jerk limit" });
    }
  }
  if (!finalFollowerOwnsAngularValidation && (path.constraints.maxAngJerk ?? 0) > 0 && angularAcceleration.length > 1) {
    const angularJerk = angularAcceleration.slice(1).flatMap((value, index) => {
      const sampleIndex = index + 2;
      const fraction = samples[sampleIndex].s / Math.max(totalDistance, EPSILON);
      const previousFraction = samples[sampleIndex - 1].s / Math.max(totalDistance, EPSILON);
      if (translationPriorityForInterval(ranges, transitions, previousFraction, fraction)) return [];
      const dt = Math.max(EPSILON, samples[index + 2].t - samples[index + 1].t);
      return [Math.abs(value - angularAcceleration[index]) / dt];
    });
    const angularJerkLimit = path.constraints.maxAngJerk! * Math.PI / 180;
    if (angularJerk.length > 0 && Math.max(...angularJerk) > angularJerkLimit * 1.03) {
      diagnostics.push({ severity: "error", path: `paths.${path.name}.constraints.maxAngJerk`, message: "LabVIEW compatibility timing could not satisfy the configured angular jerk limit" });
    }
