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
 * adjacent cubic Beziers, then average their join derivatives with weights
 * inversely proportional to the adjacent chord lengths.
 */
export function deriveLabviewSecondDerivatives(
  waypoints: readonly LabviewBezierWaypoint[],
  tangents: readonly BezierPoint[],
  epsilon = DEFAULT_EPSILON,
): BezierPoint[] {
  if (waypoints.length < 2 || tangents.length !== waypoints.length) {
    throw new RangeError("Waypoints and tangents must have the same length of at least two.");
  }

  const cubicDerivatives: CubicEndpointDerivatives[] = [];
  const chordLengths: number[] = [];
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    cubicDerivatives.push(
      cubicEndpointSecondDerivatives(
        waypoints[index],
        waypoints[index + 1],
        tangents[index],
        tangents[index + 1],
      ),
    );
    chordLengths.push(distance(waypoints[index], waypoints[index + 1]));
  }

  const result: BezierPoint[] = [cubicDerivatives[0].start];
  for (let index = 1; index < waypoints.length - 1; index += 1) {
    const leftWeight = 1 / Math.max(chordLengths[index - 1], epsilon);
    const rightWeight = 1 / Math.max(chordLengths[index], epsilon);
    result.push(
      weightedMean(
        cubicDerivatives[index - 1].end,
        leftWeight,
        cubicDerivatives[index].start,
        rightWeight,
      ),
    );
  }
  result.push(cubicDerivatives[cubicDerivatives.length - 1].end);
  return result;
}

export function makeLabviewQuinticControlPoints(
  start: BezierPoint,
  end: BezierPoint,
  startTangent: BezierPoint,
  endTangent: BezierPoint,
  startSecondDerivative: BezierPoint,
  endSecondDerivative: BezierPoint,
): QuinticControlPoints {
  const p0 = { ...start };
  const p1 = add(start, scale(startTangent, 1 / 5));
  const p2 = add(add(scale(startSecondDerivative, 1 / 20), scale(p1, 2)), scale(start, -1));
  const p5 = { ...end };
  const p4 = subtract(end, scale(endTangent, 1 / 5));
  const p3 = add(add(scale(endSecondDerivative, 1 / 20), scale(p4, 2)), scale(end, -1));
  return [p0, p1, p2, p3, p4, p5];
}

function evaluateBezier(controlPoints: readonly BezierPoint[], t: number): BezierPoint {
  const points = controlPoints.map((point) => ({ ...point }));
  for (let level = points.length - 1; level > 0; level -= 1) {
    for (let index = 0; index < level; index += 1) {
      points[index] = {
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t,
      };
    }
  }
  return points[0];
}

function derivativeControlPoints(controlPoints: readonly BezierPoint[]): BezierPoint[] {
  const degree = controlPoints.length - 1;
  return controlPoints.slice(0, -1).map((point, index) => scale(subtract(controlPoints[index + 1], point), degree));
}

export function evaluateLabviewQuintic(segment: LabviewQuinticSegment, t: number): BezierPoint {
  return evaluateBezier(segment.controlPoints, Math.max(0, Math.min(1, t)));
}

export function evaluateLabviewQuinticDerivative(segment: LabviewQuinticSegment, t: number): BezierPoint {
  return evaluateBezier(derivativeControlPoints(segment.controlPoints), Math.max(0, Math.min(1, t)));
}

export function evaluateLabviewQuinticSecondDerivative(segment: LabviewQuinticSegment, t: number): BezierPoint {
  const firstDerivative = derivativeControlPoints(segment.controlPoints);
  return evaluateBezier(derivativeControlPoints(firstDerivative), Math.max(0, Math.min(1, t)));
}

export function signedLabviewQuinticCurvature(segment: LabviewQuinticSegment, t: number): number {
  const first = evaluateLabviewQuinticDerivative(segment, t);
  const second = evaluateLabviewQuinticSecondDerivative(segment, t);
  const speedSquared = first.x * first.x + first.y * first.y;
  if (speedSquared <= DEFAULT_EPSILON * DEFAULT_EPSILON) return 0;
  return (first.x * second.y - first.y * second.x) / Math.pow(speedSquared, 1.5);
}

/** Computes arc length over [t0, t1] with the reference's order-24 rule. */
export function labviewQuinticArcLength(
  segment: LabviewQuinticSegment,
  t0 = 0,
  t1 = 1,
): number {
  const start = Math.max(0, Math.min(1, t0));
  const end = Math.max(0, Math.min(1, t1));
  if (start === end) return 0;

  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const midpoint = (low + high) / 2;
  const halfWidth = (high - low) / 2;
  let sum = 0;
  for (let index = 0; index < GAUSS_24_ABSCISSAE.length; index += 1) {
    const offset = halfWidth * GAUSS_24_ABSCISSAE[index];
    const leftSpeed = magnitude(evaluateLabviewQuinticDerivative(segment, midpoint - offset));
    const rightSpeed = magnitude(evaluateLabviewQuinticDerivative(segment, midpoint + offset));
    sum += GAUSS_24_WEIGHTS[index] * (leftSpeed + rightSpeed);
  }
  return halfWidth * sum;
}

export function buildLabviewQuinticSpline(
  waypoints: readonly LabviewBezierWaypoint[],
): LabviewQuinticSpline {
  if (waypoints.length < 2) throw new RangeError("At least two waypoints are required.");
  waypoints.forEach((waypoint, index) => {
    requireFinitePoint(waypoint, `Waypoint ${index}`);
    if (waypoint.prevC) requireFinitePoint(waypoint.prevC, `Waypoint ${index} prevC`);
    if (waypoint.nextC) requireFinitePoint(waypoint.nextC, `Waypoint ${index} nextC`);
  });

  const tangents = deriveLabviewTangents(waypoints);
  const secondDerivatives = deriveLabviewSecondDerivatives(waypoints, tangents);
  const segments = waypoints.slice(0, -1).map((waypoint, index): LabviewQuinticSegment => ({
    index,
    controlPoints: makeLabviewQuinticControlPoints(
      waypoint,
      waypoints[index + 1],
      tangents[index],
      tangents[index + 1],
      secondDerivatives[index],
      secondDerivatives[index + 1],
    ),
  }));
  const segmentLengths = segments.map((segment) => labviewQuinticArcLength(segment));
  const cumulativeLengths = [0];
  for (const segmentLength of segmentLengths) {
    cumulativeLengths.push(cumulativeLengths[cumulativeLengths.length - 1] + segmentLength);
  }

  return {
    segments,
    tangents,
    secondDerivatives,
    segmentLengths,
    cumulativeLengths,
    totalLength: cumulativeLengths[cumulativeLengths.length - 1],
  };
}

export function labviewQuinticParameterAtDistance(
  spline: LabviewQuinticSpline,
  requestedDistance: number,
  options: ArcLengthInversionOptions = {},
): SplineParameter {
  if (spline.segments.length === 0) throw new RangeError("The spline has no segments.");
  if (!Number.isFinite(requestedDistance)) throw new RangeError("Distance must be finite.");

  const targetDistance = Math.max(0, Math.min(spline.totalLength, requestedDistance));
  if (targetDistance <= 0) return { segmentIndex: 0, t: 0 };
  if (targetDistance >= spline.totalLength) return { segmentIndex: spline.segments.length - 1, t: 1 };

  let segmentIndex = 0;
  while (spline.cumulativeLengths[segmentIndex + 1] < targetDistance) segmentIndex += 1;
  const localTarget = targetDistance - spline.cumulativeLengths[segmentIndex];
  const segment = spline.segments[segmentIndex];
  const tolerance = options.tolerance ?? DEFAULT_LENGTH_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_INVERSION_ITERATIONS;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const midpoint = (low + high) / 2;
    const midpointLength = labviewQuinticArcLength(segment, 0, midpoint);
    if (Math.abs(midpointLength - localTarget) <= tolerance) return { segmentIndex, t: midpoint };
    if (midpointLength < localTarget) low = midpoint;
    else high = midpoint;
  }
  return { segmentIndex, t: (low + high) / 2 };
}

export function sampleLabviewQuinticAtDistance(
  spline: LabviewQuinticSpline,
  requestedDistance: number,
  options?: ArcLengthInversionOptions,
): QuinticSplineSample {
  const distanceAlongSpline = Math.max(0, Math.min(spline.totalLength, requestedDistance));
  const parameter = labviewQuinticParameterAtDistance(spline, distanceAlongSpline, options);
  const segment = spline.segments[parameter.segmentIndex];
  const point = evaluateLabviewQuintic(segment, parameter.t);
  const derivative = evaluateLabviewQuinticDerivative(segment, parameter.t);
  return {
    ...parameter,
    ...point,
    distance: distanceAlongSpline,
    headingRad: Math.atan2(derivative.y, derivative.x),
    curvature: signedLabviewQuinticCurvature(segment, parameter.t),
  };
}

/** Returns exactly `count` samples, including both endpoints. */
export function sampleLabviewQuinticByCount(
  spline: LabviewQuinticSpline,
  count: number,
  options?: ArcLengthInversionOptions,
): QuinticSplineSample[] {
  if (!Number.isInteger(count) || count < 2) throw new RangeError("Sample count must be an integer of at least two.");
  return Array.from({ length: count }, (_, index) =>
    sampleLabviewQuinticAtDistance(spline, (spline.totalLength * index) / (count - 1), options),
  );
}

/** Returns samples at fixed arc-distance spacing and always includes the end. */
export function sampleLabviewQuinticByDistance(
  spline: LabviewQuinticSpline,
  spacing: number,
  options?: ArcLengthInversionOptions,
): QuinticSplineSample[] {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new RangeError("Sample spacing must be positive and finite.");
  if (spline.totalLength <= DEFAULT_EPSILON) {
    return [sampleLabviewQuinticAtDistance(spline, 0, options)];
  }

  const samples: QuinticSplineSample[] = [];
  for (let sampleDistance = 0; sampleDistance < spline.totalLength; sampleDistance += spacing) {
    samples.push(sampleLabviewQuinticAtDistance(spline, sampleDistance, options));
  }
  samples.push(sampleLabviewQuinticAtDistance(spline, spline.totalLength, options));
  return samples;
}
