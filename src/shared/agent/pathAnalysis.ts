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
      const candidate = Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y);
      if (candidate < distance) { distance = candidate; best = index; }
    }
    cursor = best;
    return best;
  });
}

export interface AnalyzePathOptions {
  plannerId?: TrajectoryPlannerId;
  sampleLimit?: number;
  minimumClearanceM?: number;
  robotHeightM?: number;
  requiredTraversal?: "direct" | "trench-table" | "trench-away" | "bump-table" | "bump-away";
  /** Exact ordered portal visits for mixed outbound/inbound route contracts. */
  requiredPortalIds?: string[];
}

function sampleReference(path: PathDoc, samples: readonly TrajectorySample[], index: number): PathSampleReference {
  const sample = samples[index];
  const arrivals = waypointArrivalIndices(path, samples);
  let segmentIndex = 0;
  for (let waypointIndex = 1; waypointIndex < arrivals.length - 1; waypointIndex += 1) {
    if (arrivals[waypointIndex] <= index) segmentIndex = waypointIndex;
  }
  const nearestWaypointIndex = arrivals.reduce((best, arrival, waypointIndex) => (
    Math.abs(arrival - index) < Math.abs(arrivals[best] - index) ? waypointIndex : best
  ), 0);
  return {
    index,
    timeS: sample.t,
    distanceM: sample.s,
    fraction: sample.f,
    x: sample.x,
    y: sample.y,
    physicalHeadingRad: sample.headingRad,
    segmentIndex: Math.min(path.waypoints.length - 2, Math.max(0, segmentIndex)),
    nearestWaypointIndex,
  };
}

function maxBy(values: readonly MeasuredValue[], metric: PathAnalysisMetric, absolute = true): MeasuredValue | undefined {
  return values.filter((item) => item.metric === metric).reduce<MeasuredValue | undefined>((best, item) => {
    if (!best) return item;
    return (absolute ? Math.abs(item.value) > Math.abs(best.value) : item.value > best.value) ? item : best;
  }, undefined);
}

function measuredValues(samples: readonly TrajectorySample[]): MeasuredValue[] {
  const values: MeasuredValue[] = [];
  samples.forEach((sample, index) => {
    values.push({ metric: "velocity", value: Math.abs(sample.velocityMps), unit: "m/s", sampleIndex: index });
    values.push({ metric: "acceleration", value: Math.max(0, sample.accelerationMps2), unit: "m/s²", sampleIndex: index });
    values.push({ metric: "deceleration", value: Math.max(0, -sample.accelerationMps2), unit: "m/s²", sampleIndex: index });
    values.push({ metric: "angularVelocity", value: Math.abs(sample.angularVelocityRadps), unit: "rad/s", sampleIndex: index });
    values.push({ metric: "curvature", value: Math.abs(sample.curvatureInvM), unit: "1/m", sampleIndex: index });
    if (index === 0) return;
    const previous = samples[index - 1];
    const dt = sample.t - previous.t;
    if (dt <= EPSILON) return;
    const angularAcceleration = (sample.angularVelocityRadps - previous.angularVelocityRadps) / dt;
    const angularSpeedChange = (Math.abs(sample.angularVelocityRadps) - Math.abs(previous.angularVelocityRadps)) / dt;
    values.push({ metric: "angularAcceleration", value: Math.max(0, angularSpeedChange), unit: "rad/s²", sampleIndex: index });
    values.push({ metric: "angularDeceleration", value: Math.max(0, -angularSpeedChange), unit: "rad/s²", sampleIndex: index });
    if (index < 2) return;
    const before = samples[index - 2];
    const previousDt = previous.t - before.t;
    if (previousDt <= EPSILON) return;
    const previousAngularAcceleration = (previous.angularVelocityRadps - before.angularVelocityRadps) / previousDt;
    values.push({ metric: "jerk", value: Math.abs((sample.accelerationMps2 - previous.accelerationMps2) / dt), unit: "m/s³", sampleIndex: index });
    values.push({ metric: "angularJerk", value: Math.abs((angularAcceleration - previousAngularAcceleration) / dt), unit: "rad/s³", sampleIndex: index });
  });
  return values;
}

function downsample(samples: readonly TrajectorySample[], limit: number, retainedIndices: ReadonlySet<number>): TrajectorySample[] {
  if (samples.length <= limit) return samples.map((sample) => ({ ...sample }));
  const indices = new Set<number>([0, samples.length - 1, ...retainedIndices]);
  const remaining = Math.max(0, limit - indices.size);
  for (let slot = 1; slot <= remaining; slot += 1) {
    indices.add(Math.round(slot * (samples.length - 1) / (remaining + 1)));
  }
  return [...indices].sort((a, b) => a - b).slice(0, limit).map((index) => ({ ...samples[index], i: index }));
}

function appObstacleBounds() {
  return REBUILT_2026_FIELD.solidObstacles.flatMap((item) => {
    if (!item.bounds) return [];
    const first = officialToAppPoint({ x: item.bounds.xMin, y: item.bounds.yMin });
    const second = officialToAppPoint({ x: item.bounds.xMax, y: item.bounds.yMax });
    return [{
      id: item.id,
      name: item.name,
      min: { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) },
      max: { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) },
    }];
  });
}

function portalBounds(portal: typeof REBUILT_2026_FIELD.crossingBarriers[number]["portals"][number]) {
  const point = officialToAppPoint(portal.point);
  const halfWidth = portal.widthM * FIELD_H / REBUILT_2026_FIELD_WIDTH_M / 2;
  return { minY: point.y - halfWidth, maxY: point.y + halfWidth };
}

function portalsForSection(
  barrier: typeof REBUILT_2026_FIELD.crossingBarriers[number],
  section: { minY: number; maxY: number },
) {
  return barrier.portals.filter((portal) => {
    const bounds = portalBounds(portal);
    return section.minY >= bounds.minY - EPSILON && section.maxY <= bounds.maxY + EPSILON;
  });
}

function crossingPose(previous: TrajectorySample, sample: TrajectorySample, x: number) {
  const ratio = Math.max(0, Math.min(1, (x - previous.x) / (sample.x - previous.x)));
  return {
    x,
    y: previous.y + (sample.y - previous.y) * ratio,
    headingRad: interpolateHeading(previous.headingRad, sample.headingRad, ratio),
    ratio,
  };
}

function footprintSectionAt(project: BordeauxProject, pose: { x: number; y: number; headingRad: number }, x: number) {
  return verticalLineSection(robotFootprintAt(project.robot, pose), x);
}

function barrierCrossingFindings(
  project: BordeauxProject,
  path: PathDoc,
  samples: readonly TrajectorySample[],
  robotHeightM?: number,
  requiredTraversal: AnalyzePathOptions["requiredTraversal"] = "direct",
): PathAnalysisFinding[] {
  const effectiveHeightM = project.robot.heightM ?? robotHeightM;
  const findings: PathAnalysisFinding[] = [];
  let traversalUseCount = 0;
  REBUILT_2026_FIELD.crossingBarriers.forEach((barrier) => {
    const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
    const validatePortal = (portals: typeof barrier.portals, index: number, suffix: string, verb: "crosses" | "touches") => {
      if (portals.length !== 1) {
        findings.push({ id: `geometry:illegal-barrier-${verb}:${suffix}`, severity: "error", kind: "geometry", message: `The robot footprint ${verb} the ${barrier.allianceOwner} alliance barrier outside a typed TRENCH or BUMP corridor.`, sample: sampleReference(path, samples, index), sourcePath: `field.2026-rebuilt.crossingBarriers.${barrier.id}` });
        return;
      }
      const portal = portals[0];
      if (requiredTraversal !== "direct") {
        const [requiredType, requiredSide] = requiredTraversal.split("-") as ["trench" | "bump", "table" | "away"];
        if (portal.traversal !== requiredType || portal.side !== requiredSide) findings.push({ id: `geometry:wrong-traversal:${suffix}`, severity: "error", kind: "geometry", message: `This candidate uses ${portal.name} instead of the required ${requiredSide} ${requiredType.toUpperCase()} corridor.`, sample: sampleReference(path, samples, index), sourcePath: `field.2026-rebuilt.crossingBarriers.${barrier.id}` });
      }
      if (portal.traversal === "trench") {
        if (effectiveHeightM === undefined) findings.push({ id: `geometry:trench-height-unverified:${suffix}`, severity: "warning", kind: "geometry", message: `Robot height is required to certify passage under ${portal.name}.`, sample: sampleReference(path, samples, index), sourcePath: `field.2026-rebuilt.crossingBarriers.${barrier.id}` });
        else if (portal.clearanceHeightM !== undefined && effectiveHeightM > portal.clearanceHeightM + EPSILON) findings.push({ id: `geometry:trench-height:${suffix}`, severity: "error", kind: "geometry", measured: effectiveHeightM, limit: portal.clearanceHeightM, unit: "m", message: `Robot height ${effectiveHeightM.toFixed(3)} m exceeds the ${portal.clearanceHeightM.toFixed(3)} m clearance under ${portal.name}.`, sample: sampleReference(path, samples, index), sourcePath: `field.2026-rebuilt.crossingBarriers.${barrier.id}` });
      }
    };
    [0, samples.length - 1].forEach((index) => {
      if (index < 0) return;
      const section = footprintSectionAt(project, samples[index], barrierX);
      if (!section) return;
      const endpointPortals = portalsForSection(barrier, section);
      if (requiredTraversal !== "direct" && endpointPortals.length === 1) {
        const [requiredType, requiredSide] = requiredTraversal.split("-") as ["trench" | "bump", "table" | "away"];
        if (endpointPortals[0].traversal === requiredType && endpointPortals[0].side === requiredSide) traversalUseCount += 1;
      }
      validatePortal(endpointPortals, index, `${barrier.id}:endpoint:${index}`, "touches");
    });
    const unsafeApproachIndex = samples.findIndex((sample) => {
      const section = footprintSectionAt(project, sample, barrierX);
      return section !== null && portalsForSection(barrier, section).length !== 1;
    });
    if (unsafeApproachIndex >= 0) validatePortal([], unsafeApproachIndex, `${barrier.id}:footprint:${unsafeApproachIndex}`, "touches");
    let previousIndex = -1;
    let previousSide = 0;
    samples.forEach((sample, index) => {
      const delta = sample.x - barrierX;
      const side = Math.abs(delta) <= BARRIER_EPSILON ? 0 : Math.sign(delta);
      if (side === 0) return;
      if (previousIndex >= 0 && previousSide !== side) {
        traversalUseCount += 1;
