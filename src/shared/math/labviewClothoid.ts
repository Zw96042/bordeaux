/**
 * Standalone geometry compatible with Bordeaux's polyline-corner clothoid model.
 *
 * This deliberately does not share code with the editor's endpoint-pose G1
 * clothoid. Bordeaux trims each polyline leg and inserts a symmetric Euler
 * spiral at the vertex instead.
 */

export interface LabviewClothoidWaypoint {
  x: number;
  y: number;
}

export type LabviewClothoidPointKind =
  | "straight"
  | "clothoid-entry"
  | "arc"
  | "clothoid-exit";

export interface LabviewClothoidPoint {
  x: number;
  y: number;
  /** Continuous, unwrapped heading in radians. */
  heading: number;
  /** Signed curvature in inverse waypoint-distance units. */
  curvature: number;
  /** Cumulative Cartesian distance in waypoint-distance units. */
  s: number;
  kind: LabviewClothoidPointKind;
}

interface Vector {
  x: number;
  y: number;
}

interface LocalPoint extends Vector {
  heading: number;
  curvature: number;
  kind: Exclude<LabviewClothoidPointKind, "straight">;
}

interface CornerRecipe {
  waypointIndex: number;
  incoming: Vector;
  outgoing: Vector;
  incomingHeading: number;
  turn: number;
  local: LocalPoint[];
  entryTrim: number;
  exitTrim: number;
  scale: number;
}

const TAU_STEP = 0.001;
const HALF_PI = Math.PI / 2;
const POSITION_EPSILON = 1e-10;
const ANGLE_EPSILON = 1e-6;

function cross(a: Vector, b: Vector): number {
  return a.x * b.y - a.y * b.x;
}

function dot(a: Vector, b: Vector): number {
  return a.x * b.x + a.y * b.y;
}

function subtract(a: Vector, b: Vector): Vector {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(vector: Vector): number {
  return Math.hypot(vector.x, vector.y);
}

function unit(vector: Vector): Vector {
  const magnitude = length(vector);
  if (magnitude <= POSITION_EPSILON) {
    throw new Error("LabVIEW clothoid waypoints must not contain zero-length legs");
  }
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

