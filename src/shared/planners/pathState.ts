import type { PathDoc, TrajectorySample } from "../types";

const EPSILON = 1e-9;

export interface CanonicalPathPoint {
  sourceIndex: number;
  s: number;
  f: number;
  x: number;
  y: number;
  tangentRad: number;
  tangentX: number;
  tangentY: number;
  normalX: number;
  normalY: number;
  curvatureInvM: number;
  headingRad: number;
  headingDerivativeRadPerM: number;
  headingSecondDerivativeRadPerM2: number;
  segmentIndex: number;
  segmentFraction: number;
  waypointIndex?: number;
  stop: boolean;
}

export interface CanonicalPathState {
  points: CanonicalPathPoint[];
  waypointSampleIndices: number[];
  totalDistanceM: number;
}

function unwrap(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    let delta = values[index] - result[index - 1];
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    result.push(result[index - 1] + delta);
  }
  return result;
}

function derivative(
  values: readonly number[],
  positions: readonly number[],
  breaks: ReadonlySet<number> = new Set(),
): number[] {
  return values.map((_value, index) => {
    let before = index === 0 ? 0 : index - 1;
    let after = index === values.length - 1 ? values.length - 1 : index + 1;
    if (breaks.has(index)) {
      if (after > index) before = index;
      else after = index;
    } else {
      if (breaks.has(before)) before = index;
      if (breaks.has(after)) after = index;
    }
    const distance = positions[after] - positions[before];
    return distance > EPSILON ? (values[after] - values[before]) / distance : 0;
  });
}

function waypointSampleIndices(path: PathDoc, samples: readonly TrajectorySample[]): number[] {
  let cursor = 0;
  return path.waypoints.map((waypoint, waypointIndex) => {
    if (waypointIndex === path.waypoints.length - 1) return Math.max(0, samples.length - 1);
    let best = cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = cursor; index < samples.length; index += 1) {
      const distance = Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    cursor = best;
    return best;
  });
}

export function buildCanonicalPathState(
  path: PathDoc,
  samples: readonly TrajectorySample[],
  headingBreaks: ReadonlySet<number> = new Set(),
  syntheticStops: ReadonlySet<number> = new Set(),
): CanonicalPathState {
  if (samples.length < 2) throw new Error("Canonical path state requires at least two trajectory samples.");
  const positions = samples.map((sample) => sample.s);
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) throw new Error(`Trajectory distance ${index} must be finite.`);
    if (index > 0 && positions[index] < positions[index - 1] - EPSILON) {
      throw new Error("Trajectory distances must be monotonic.");
    }
  }

  const waypointIndices = waypointSampleIndices(path, samples);
  const stoppedSamples = new Set<number>();
  waypointIndices.forEach((sampleIndex, waypointIndex) => {
    if (path.waypoints[waypointIndex]?.stop) stoppedSamples.add(sampleIndex);
  });
  const tangentXRaw = derivative(samples.map((sample) => sample.x), positions, stoppedSamples);
  const tangentYRaw = derivative(samples.map((sample) => sample.y), positions, stoppedSamples);
  const tangentAngles = unwrap(tangentXRaw.map((x, index) => Math.atan2(tangentYRaw[index], x)));
  const curvatures = derivative(tangentAngles, positions, stoppedSamples);
  const headings = unwrap(samples.map((sample) => sample.headingRad));
  const headingDerivativeBreaks = new Set([...stoppedSamples, ...headingBreaks]);
  const headingDerivatives = derivative(headings, positions, headingDerivativeBreaks);
  const headingSecondDerivatives = derivative(headingDerivatives, positions, headingDerivativeBreaks);
  const waypointBySample = new Map<number, number>();
  waypointIndices.forEach((sampleIndex, waypointIndex) => {
    if (!waypointBySample.has(sampleIndex)) waypointBySample.set(sampleIndex, waypointIndex);
  });

  let segment = 0;
  const points = samples.map((sample, index): CanonicalPathPoint => {
    while (segment < waypointIndices.length - 2 && index > waypointIndices[segment + 1]) segment += 1;
    const length = Math.hypot(tangentXRaw[index], tangentYRaw[index]);
    const tangentX = length > EPSILON ? tangentXRaw[index] / length : Math.cos(tangentAngles[index]);
    const tangentY = length > EPSILON ? tangentYRaw[index] / length : Math.sin(tangentAngles[index]);
    const segmentStart = waypointIndices[segment] ?? 0;
    const segmentEnd = waypointIndices[segment + 1] ?? Math.max(segmentStart, samples.length - 1);
    const waypointIndex = waypointBySample.get(index);
    const sampledCurvature = Math.abs(sample.curvatureInvM);
    const derivedCurvature = curvatures[index];
    const curvatureSign = Math.sign(derivedCurvature) || 1;
    return {
      sourceIndex: index,
      s: sample.s,
      f: sample.f,
      x: sample.x,
      y: sample.y,
      tangentRad: tangentAngles[index],
      tangentX,
      tangentY,
      normalX: -tangentY,
      normalY: tangentX,
      // PM evaluates Bezier/arc/clothoid curvature on the authored geometry.
      // Keep its magnitude so finite-difference smoothing cannot hide a local
      // peak, while retaining the signed direction needed by drivetrain math.
      curvatureInvM: curvatureSign * Math.max(Math.abs(derivedCurvature), sampledCurvature),
      headingRad: headings[index],
      headingDerivativeRadPerM: headingDerivatives[index],
      headingSecondDerivativeRadPerM2: headingSecondDerivatives[index],
      segmentIndex: segment,
      segmentFraction: segmentEnd > segmentStart ? (index - segmentStart) / (segmentEnd - segmentStart) : 0,
      ...(waypointIndex !== undefined ? { waypointIndex } : {}),
      stop: stoppedSamples.has(index) || syntheticStops.has(index),
    };
  });

  return {
    points,
    waypointSampleIndices: waypointIndices,
    totalDistanceM: samples.at(-1)?.s ?? 0,
  };
}

export function findDynamicHeadingStops(
  state: CanonicalPathState,
  stopAtIndex?: number,
): Set<number> {
  const result = new Set<number>();
  state.waypointSampleIndices.slice(1, -1).forEach((sampleIndex) => {
    if (stopAtIndex !== undefined && sampleIndex >= stopAtIndex) return;
    const before = state.points[sampleIndex - 1];
    const point = state.points[sampleIndex];
    const after = state.points[sampleIndex + 1];
    if (!before || !point || !after || point.stop) return;
    const beforeDistance = point.s - before.s;
    const afterDistance = after.s - point.s;
    if (beforeDistance <= EPSILON || afterDistance <= EPSILON) return;
    const incomingRate = (point.headingRad - before.headingRad) / beforeDistance;
    const outgoingRate = (after.headingRad - point.headingRad) / afterDistance;
    if (Math.abs(outgoingRate - incomingRate) > 0.05) result.add(sampleIndex);
  });
  return result;
}

export function interpolatePathPoint(
  before: CanonicalPathPoint,
  after: CanonicalPathPoint,
  fraction = 0.5,
): CanonicalPathPoint {
  const t = Math.max(0, Math.min(1, fraction));
  const mix = (first: number, second: number) => first + (second - first) * t;
  const phasePoint = after.stop ? before : before.stop ? after : undefined;
  const tangentRad = phasePoint?.tangentRad ?? mix(before.tangentRad, after.tangentRad);
  return {
    sourceIndex: before.sourceIndex,
    s: mix(before.s, after.s),
    f: mix(before.f, after.f),
    x: mix(before.x, after.x),
    y: mix(before.y, after.y),
    tangentRad,
    tangentX: Math.cos(tangentRad),
    tangentY: Math.sin(tangentRad),
    normalX: -Math.sin(tangentRad),
    normalY: Math.cos(tangentRad),
    curvatureInvM: phasePoint?.curvatureInvM ?? mix(before.curvatureInvM, after.curvatureInvM),
    headingRad: phasePoint?.headingRad ?? mix(before.headingRad, after.headingRad),
    headingDerivativeRadPerM: phasePoint?.headingDerivativeRadPerM
      ?? mix(before.headingDerivativeRadPerM, after.headingDerivativeRadPerM),
    headingSecondDerivativeRadPerM2: phasePoint?.headingSecondDerivativeRadPerM2
      ?? mix(before.headingSecondDerivativeRadPerM2, after.headingSecondDerivativeRadPerM2),
    segmentIndex: before.segmentIndex,
    segmentFraction: mix(before.segmentFraction, after.segmentFraction),
    stop: false,
  };
}
