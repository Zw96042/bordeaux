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

function reflectVector(vector: Vector, axisAngle: number): Vector {
  const axis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
  const projection = 2 * dot(vector, axis);
  return {
    x: projection * axis.x - vector.x,
    y: projection * axis.y - vector.y,
  };
}

function rotate(vector: Vector, angle: number): Vector {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * vector.x - sine * vector.y,
    y: sine * vector.x + cosine * vector.y,
  };
}

/**
 * Build one canonical corner starting at the entry tangent origin.
 *
 * For turns through at most 90 degrees, tauMax = sqrt(|alpha| / 2).
 * Larger turns keep 45 degrees in each spiral and put the remaining angle in
 * a radius-R circular arc, matching the rebuilt VI's ExtraArc construction.
 */
function canonicalBlend(turn: number, minRadius: number): LocalPoint[] {
  const sign = Math.sign(turn);
  const absoluteTurn = Math.abs(turn);
  const spiralTurn = Math.min(absoluteTurn, HALF_PI);
  const halfSpiralHeading = spiralTurn / 2;
  const tauMax = Math.sqrt(halfSpiralHeading);
  const sigma = 2 * minRadius * tauMax;
  const extraArc = absoluteTurn - spiralTurn;

  const entry: LocalPoint[] = [{
    x: 0,
    y: 0,
    heading: 0,
    curvature: 0,
    kind: "clothoid-entry",
  }];

  let tau = 0;
  let x = 0;
  let y = 0;
  while (tau < tauMax - Number.EPSILON) {
    const step = Math.min(TAU_STEP, tauMax - tau);
    const heading = sign * tau * tau;
    // Rebuilt Determine/Generate Clothoid Values uses this left-endpoint sum.
    x += sigma * Math.cos(heading) * step;
    y += sigma * Math.sin(heading) * step;
    tau += step;
    entry.push({
      x,
      y,
      heading: sign * tau * tau,
      // With s = sigma*tau, this is the requested k = 2s/sigma^2.
      curvature: sign * 2 * tau / sigma,
      kind: "clothoid-entry",
    });
  }

  const local = entry.slice();
  let exitStart = entry[entry.length - 1];
  if (extraArc > ANGLE_EPSILON) {
    const startHeading = sign * halfSpiralHeading;
    const normal = { x: -Math.sin(startHeading) * sign, y: Math.cos(startHeading) * sign };
    const center = {
      x: exitStart.x + normal.x * minRadius,
      y: exitStart.y + normal.y * minRadius,
    };
    const radialStart = Math.atan2(exitStart.y - center.y, exitStart.x - center.x);
    const arcStep = Math.max(ANGLE_EPSILON, sigma * TAU_STEP / minRadius);
    const arcCount = Math.max(1, Math.ceil(extraArc / arcStep));
    for (let index = 1; index <= arcCount; index += 1) {
      const swept = extraArc * index / arcCount;
      const radial = radialStart + sign * swept;
      exitStart = {
        x: center.x + minRadius * Math.cos(radial),
        y: center.y + minRadius * Math.sin(radial),
        heading: sign * (halfSpiralHeading + swept),
        curvature: sign / minRadius,
        kind: "arc",
      };
      local.push(exitStart);
    }
  }

  // Bordeaux reflects the entry deltas in reverse order to form the exit.
  const reflectionAxis = turn / 2;
  let current = exitStart;
  for (let index = entry.length - 1; index > 0; index -= 1) {
    const delta = {
      x: entry[index].x - entry[index - 1].x,
      y: entry[index].y - entry[index - 1].y,
    };
    const reflected = reflectVector(delta, reflectionAxis);
    current = {
      x: current.x + reflected.x,
      y: current.y + reflected.y,
      heading: turn - entry[index - 1].heading,
      curvature: entry[index - 1].curvature,
      kind: "clothoid-exit",
    };
    local.push(current);
  }

  return local;
}

function tangentTrims(local: readonly LocalPoint[], turn: number): { entry: number; exit: number } {
  const endpoint = local[local.length - 1];
  const outgoing = { x: Math.cos(turn), y: Math.sin(turn) };
  const denominator = outgoing.y;
  if (Math.abs(denominator) <= ANGLE_EPSILON) {
    throw new Error("LabVIEW clothoid cannot construct a tangent blend for a 180-degree reversal");
  }

  // Intersection of y=0 with endpoint - exit*Uout.
  const exit = endpoint.y / denominator;
  const entry = endpoint.x - exit * outgoing.x;
  if (!(entry > 0) || !(exit > 0) || !Number.isFinite(entry + exit)) {
    throw new Error("LabVIEW clothoid produced an invalid tangent intersection");
  }
  return { entry, exit };
}

function cornerRecipe(
  waypoints: readonly LabviewClothoidWaypoint[],
  waypointIndex: number,
  minRadius: number,
): CornerRecipe | null {
  const previous = waypoints[waypointIndex - 1];
  const vertex = waypoints[waypointIndex];
  const next = waypoints[waypointIndex + 1];
  const incoming = unit(subtract(vertex, previous));
  const outgoing = unit(subtract(next, vertex));
  const turn = Math.atan2(cross(incoming, outgoing), dot(incoming, outgoing));
  if (Math.abs(turn) <= ANGLE_EPSILON) return null;
  if (Math.abs(Math.PI - Math.abs(turn)) <= ANGLE_EPSILON) {
    throw new Error("LabVIEW clothoid does not support a 180-degree waypoint reversal");
  }

  const local = canonicalBlend(turn, minRadius);
  const trims = tangentTrims(local, turn);
  return {
    waypointIndex,
    incoming,
    outgoing,
    incomingHeading: Math.atan2(incoming.y, incoming.x),
    turn,
    local,
    entryTrim: trims.entry,
    exitTrim: trims.exit,
    scale: 1,
  };
}

/**
 * Reduce adjacent recipes together until their trims fit each polyline leg.
 * The rebuilt overlap VI's exact preference rules are not recoverable from its
 * binary dataflow, so this deterministic policy conservatively avoids crossing
 * trims and preserves both tangent directions and blend symmetry.
 */
function resolveOverlaps(
  waypoints: readonly LabviewClothoidWaypoint[],
  recipes: readonly (CornerRecipe | null)[],
): void {
  for (let edgeIndex = 0; edgeIndex < waypoints.length - 1; edgeIndex += 1) {
    const edgeLength = length(subtract(waypoints[edgeIndex + 1], waypoints[edgeIndex]));
    const left = edgeIndex > 0 ? recipes[edgeIndex] : null;
    const right = edgeIndex + 1 < waypoints.length - 1 ? recipes[edgeIndex + 1] : null;
    const required = (left ? left.exitTrim * left.scale : 0) + (right ? right.entryTrim * right.scale : 0);
    if (required <= edgeLength || required <= POSITION_EPSILON) continue;
    const reduction = Math.max(0, (edgeLength - POSITION_EPSILON) / required);
    if (left) left.scale *= reduction;
    if (right) right.scale *= reduction;
  }
}

