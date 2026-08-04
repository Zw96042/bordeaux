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

