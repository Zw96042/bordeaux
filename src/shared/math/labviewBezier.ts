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
