import { REBUILT_2026_FIELD, REBUILT_2026_FIELD_WIDTH_M, officialToAppPoint } from "../field/rebuilt2026";
import { FIELD_H, FIELD_W } from "../math/fieldBounds";
import { getPlanner } from "../planners";
import { clone } from "../project/defaults";
import type { BordeauxProject, PathDoc, TrajectoryPlannerId, TrajectorySample, ValidationIssue } from "../types";
import { validateProject } from "../validation";
import {
  boundsPolygon,
  convexPolygonClearance,
  footprintBoundsClearance,
  interpolateHeading,
  polygonBounds,
  robotFootprintAt,
  verticalLineSection,
} from "./robotFootprint";
import type {
  PathAnalysis,
  PathAnalysisExtremum,
  PathAnalysisFinding,
  PathAnalysisMetric,
  PathSampleReference,
} from "./types";

const EPSILON = 1e-6;
const BARRIER_EPSILON = 1e-4;
const DEFAULT_SAMPLE_LIMIT = 500;

interface MeasuredValue {
  metric: PathAnalysisMetric;
  value: number;
  unit: string;
  sampleIndex: number;
}

function waypointRangeDistance(waypointDistances: readonly number[], waypointIndex: number, localT: number): number {
  const index = Math.max(0, Math.min(waypointDistances.length - 1, waypointIndex));
  if (index >= waypointDistances.length - 1) return waypointDistances.at(-1) ?? 0;
  return waypointDistances[index] + (waypointDistances[index + 1] - waypointDistances[index]) * Math.max(0, Math.min(1, localT));
}

function metricLimit(path: PathDoc, sample: TrajectorySample, totalDistance: number, waypointDistances: readonly number[], metric: PathAnalysisMetric): { limit?: number; source: string } {
  const global: Partial<Record<PathAnalysisMetric, number | undefined>> = {
    velocity: path.constraints.maxVel,
    acceleration: path.constraints.maxAccel,
    deceleration: path.constraints.maxDecel,
    angularVelocity: path.constraints.maxAngVel * Math.PI / 180,
    angularAcceleration: path.constraints.maxAngAccel * Math.PI / 180,
    angularDeceleration: (path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * Math.PI / 180,
    jerk: path.constraints.maxJerk && path.constraints.maxJerk > 0 ? path.constraints.maxJerk : undefined,
    angularJerk: path.constraints.maxAngJerk && path.constraints.maxAngJerk > 0 ? path.constraints.maxAngJerk * Math.PI / 180 : undefined,
  };
  let limit = global[metric];
  let source = `path.constraints.${metric === "velocity" ? "maxVel" : metric === "acceleration" ? "maxAccel" : metric === "deceleration" ? "maxDecel" : metric === "angularVelocity" ? "maxAngVel" : metric === "angularAcceleration" ? "maxAngAccel" : metric === "angularDeceleration" ? "maxAngDecel" : metric === "jerk" ? "maxJerk" : "maxAngJerk"}`;
  path.ranges.forEach((range, index) => {
    let active = false;
    if (range.anchor === "param") active = sample.f >= Math.min(range.f0, range.f1) - EPSILON && sample.f <= Math.max(range.f0, range.f1) + EPSILON;
    else if (range.anchor === "dist") {
      const first = range.d0 ?? range.f0 * totalDistance;
      const last = range.d1 ?? range.f1 * totalDistance;
      active = sample.s >= Math.min(first, last) - EPSILON && sample.s <= Math.max(first, last) + EPSILON;
    } else {
      const first = waypointRangeDistance(waypointDistances, range.w0 ?? 0, range.t0 ?? 0);
      const last = waypointRangeDistance(waypointDistances, range.w1 ?? waypointDistances.length - 1, range.t1 ?? 0);
      active = sample.s >= Math.min(first, last) - EPSILON && sample.s <= Math.max(first, last) + EPSILON;
    }
    if (!active) return;
    const local = metric === "velocity" ? range.maxVel
      : metric === "acceleration" ? range.maxAccel
        : metric === "deceleration" ? (range.maxDecel ?? range.maxAccel)
          : metric === "angularVelocity" ? range.maxAngVel * Math.PI / 180
            : metric === "angularAcceleration" || metric === "angularDeceleration" ? range.maxAngAccel * Math.PI / 180
              : undefined;
    if (local !== undefined && (limit === undefined || local < limit)) { limit = local; source = `path.ranges[${index}]`; }
  });
  return { limit, source };
}

function retainWaypointArrivals(path: PathDoc, samples: readonly TrajectorySample[], retained: Set<number>): void {
  if (samples.length === 0) return;
  waypointArrivalIndices(path, samples).forEach((index) => retained.add(index));
}

function waypointArrivalIndices(path: PathDoc, samples: readonly TrajectorySample[]): number[] {
  if (samples.length === 0) return [];
  let cursor = 0;
  return path.waypoints.map((waypoint, waypointIndex) => {
    let best = cursor;
    let distance = Number.POSITIVE_INFINITY;
    const finalSearchIndex = waypointIndex === path.waypoints.length - 1 ? samples.length - 1 : Math.max(cursor, samples.length - (path.waypoints.length - waypointIndex));
    for (let index = cursor; index <= finalSearchIndex; index += 1) {
