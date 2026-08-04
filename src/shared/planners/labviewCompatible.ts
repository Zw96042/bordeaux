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
