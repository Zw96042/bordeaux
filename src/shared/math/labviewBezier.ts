/**
 * Geometry-compatible reconstruction of Bordeaux's LabVIEW quintic Bezier
 * spline. This module intentionally contains no timing or file-format logic.
 */

export interface BezierPoint {
  x: number;
  y: number;
}

/** Structurally compatible with the position and handle fields on Waypoint. */
export interface LabviewBezierWaypoint extends BezierPoint {
  prevC?: BezierPoint;
  nextC?: BezierPoint;
}

export type QuinticControlPoints = readonly [
  BezierPoint,
  BezierPoint,
  BezierPoint,
  BezierPoint,
  BezierPoint,
  BezierPoint,
];

export interface LabviewQuinticSegment {
  index: number;
  controlPoints: QuinticControlPoints;
}

export interface LabviewQuinticSpline {
  segments: LabviewQuinticSegment[];
  tangents: BezierPoint[];
  secondDerivatives: BezierPoint[];
  segmentLengths: number[];
  cumulativeLengths: number[];
  totalLength: number;
}

export interface SplineParameter {
  segmentIndex: number;
  t: number;
}

export interface QuinticSplineSample extends SplineParameter, BezierPoint {
  distance: number;
  headingRad: number;
  /** Signed curvature. Positive values turn counter-clockwise. */
  curvature: number;
}

export interface ArcLengthInversionOptions {
  tolerance?: number;
  maxIterations?: number;
}

const DEFAULT_EPSILON = 1e-10;
const DEFAULT_LENGTH_TOLERANCE = 1e-9;
const DEFAULT_INVERSION_ITERATIONS = 48;

// Positive abscissae and matching weights for 24-point Gauss-Legendre
// quadrature. The LabVIEW VI embeds the same 24 values as +/- pairs.
const GAUSS_24_ABSCISSAE = [
  0.06405689286260563,
  0.1911188674736163,
  0.3150426796961634,
  0.4337935076260451,
  0.5454214713888395,
  0.6480936519369756,
  0.7401241915785544,
  0.8200019859739029,
  0.886415527004401,
  0.9382745520027328,
  0.9747285559713095,
  0.9951872199970213,
] as const;

const GAUSS_24_WEIGHTS = [
  0.12793819534675216,
  0.1258374563468283,
  0.12167047292780339,
  0.1155056680537256,
  0.10744427011596563,
  0.09761865210411389,
  0.08619016153195328,
  0.0733464814110803,
  0.05929858491543678,
  0.04427743881741981,
  0.028531388628933664,
  0.0123412297999872,
] as const;

const add = (a: BezierPoint, b: BezierPoint): BezierPoint => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: BezierPoint, b: BezierPoint): BezierPoint => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (point: BezierPoint, factor: number): BezierPoint => ({
  x: point.x * factor,
  y: point.y * factor,
});
const magnitude = (point: BezierPoint): number => Math.hypot(point.x, point.y);
const distance = (a: BezierPoint, b: BezierPoint): number => magnitude(subtract(b, a));

function weightedMean(a: BezierPoint, aWeight: number, b: BezierPoint, bWeight: number): BezierPoint {
  const totalWeight = aWeight + bWeight;
  if (!(totalWeight > 0)) return { x: 0, y: 0 };
  return scale(add(scale(a, aWeight), scale(b, bWeight)), 1 / totalWeight);
}

function requireFinitePoint(point: BezierPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} must contain finite x and y coordinates.`);
  }
}

function fallbackTangent(waypoints: readonly LabviewBezierWaypoint[], index: number): BezierPoint {
  if (index === 0) return subtract(waypoints[1], waypoints[0]);
  if (index === waypoints.length - 1) return subtract(waypoints[index], waypoints[index - 1]);

  const previousDistance = distance(waypoints[index - 1], waypoints[index]);
  const nextDistance = distance(waypoints[index], waypoints[index + 1]);
  const incoming = scale(subtract(waypoints[index], waypoints[index - 1]), 1 / Math.max(previousDistance, DEFAULT_EPSILON));
  const outgoing = scale(subtract(waypoints[index + 1], waypoints[index]), 1 / Math.max(nextDistance, DEFAULT_EPSILON));
  const direction = add(incoming, outgoing);
  const directionMagnitude = magnitude(direction);
  if (directionMagnitude <= DEFAULT_EPSILON) return { x: 0, y: 0 };

  // The reference's generated tangent uses half the distance to the closer
  // neighboring waypoint. Explicit handles normally avoid this fallback.
  return scale(direction, (0.5 * Math.min(previousDistance, nextDistance)) / directionMagnitude);
}

/**
 * Converts explicit handles to the derivative vector used by a degree-five
 * Bezier. Interior incoming and outgoing derivatives are averaged so both
 * adjacent segments receive one shared C1 tangent.
 */
export function deriveLabviewTangents(
  waypoints: readonly LabviewBezierWaypoint[],
  epsilon = DEFAULT_EPSILON,
): BezierPoint[] {
  if (waypoints.length < 2) throw new RangeError("At least two waypoints are required.");

  return waypoints.map((waypoint, index) => {
    const incoming = waypoint.prevC ? scale(subtract(waypoint, waypoint.prevC), 5) : undefined;
    const outgoing = waypoint.nextC ? scale(subtract(waypoint.nextC, waypoint), 5) : undefined;
    const hasIncoming = incoming !== undefined && magnitude(incoming) > epsilon;
    const hasOutgoing = outgoing !== undefined && magnitude(outgoing) > epsilon;

    if (index === 0 && hasOutgoing) return outgoing;
    if (index === waypoints.length - 1 && hasIncoming) return incoming;
    if (hasIncoming && hasOutgoing) {
      const reconciled = scale(add(incoming, outgoing), 0.5);
      if (magnitude(reconciled) > epsilon) return reconciled;
    }
    if (hasOutgoing) return outgoing;
    if (hasIncoming) return incoming;
    return fallbackTangent(waypoints, index);
  });
}

interface CubicEndpointDerivatives {
  start: BezierPoint;
  end: BezierPoint;
}

function cubicEndpointSecondDerivatives(
  start: BezierPoint,
  end: BezierPoint,
  startTangent: BezierPoint,
  endTangent: BezierPoint,
): CubicEndpointDerivatives {
  const p1 = add(start, scale(startTangent, 1 / 3));
  const p2 = subtract(end, scale(endTangent, 1 / 3));
  return {
    start: scale(add(subtract(start, scale(p1, 2)), p2), 6),
    end: scale(add(subtract(p1, scale(p2, 2)), end), 6),
  };
}

/**
 * Reconstructs the reference's shared second derivative heuristic: build the
