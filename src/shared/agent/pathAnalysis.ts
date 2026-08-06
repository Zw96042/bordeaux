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
        const previous = samples[previousIndex];
        const pose = crossingPose(previous, sample, barrierX);
        const section = footprintSectionAt(project, pose, barrierX);
        const suffix = `${barrier.id}:${findings.length}`;
        validatePortal(section ? portalsForSection(barrier, section) : [], index, suffix, "crosses");
      }
      previousIndex = index;
      previousSide = side;
    });
  });
  if (requiredTraversal !== "direct" && traversalUseCount === 0 && samples.length > 0) findings.push({ id: "geometry:required-traversal-missing", severity: "error", kind: "geometry", message: `The route requires ${requiredTraversal.replace("-", " ")} but does not cross or start/end inside that typed alliance-barrier portal.`, sample: sampleReference(path, samples, 0), sourcePath: "field.2026-rebuilt.crossingBarriers" });
  return findings;
}

function observedPortalIds(project: BordeauxProject, samples: readonly TrajectorySample[]): Array<{ id: string; sampleIndex: number }> {
  if (samples.length === 0) return [];
  const observed: Array<{ id: string; sampleIndex: number }> = [];
  const portalAt = (barrier: typeof REBUILT_2026_FIELD.crossingBarriers[number], pose: { x: number; y: number; headingRad: number }, barrierX: number) => {
    const section = footprintSectionAt(project, pose, barrierX);
    if (!section) return undefined;
    const portals = portalsForSection(barrier, section);
    return portals.length === 1 ? portals[0] : undefined;
  };
  const add = (id: string | undefined, sampleIndex: number) => {
    const previous = observed.at(-1);
    if (!id || (previous?.id === id && sampleIndex - previous.sampleIndex <= 1)) return;
    observed.push({ id, sampleIndex });
  };

  for (const barrier of REBUILT_2026_FIELD.crossingBarriers) {
    const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
    if (footprintSectionAt(project, samples[0], barrierX)) add(portalAt(barrier, samples[0], barrierX)?.id, 0);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    const visits: Array<{ id: string; ratio: number }> = [];
    for (const barrier of REBUILT_2026_FIELD.crossingBarriers) {
      const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
      const left = previous.x - barrierX;
      const right = sample.x - barrierX;
      if (left * right >= 0 || Math.abs(sample.x - previous.x) <= EPSILON) continue;
      const pose = crossingPose(previous, sample, barrierX);
      const portal = portalAt(barrier, pose, barrierX);
      if (portal) visits.push({ id: portal.id, ratio: pose.ratio });
    }
    visits.sort((left, right) => left.ratio - right.ratio).forEach((visit) => add(visit.id, index));
  }
  for (const barrier of REBUILT_2026_FIELD.crossingBarriers) {
    const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
    const lastIndex = samples.length - 1;
    if (footprintSectionAt(project, samples[lastIndex], barrierX)) add(portalAt(barrier, samples[lastIndex], barrierX)?.id, lastIndex);
  }
  return observed;
}

function requiredPortalSequenceFindings(project: BordeauxProject, path: PathDoc, samples: readonly TrajectorySample[], requiredPortalIds: readonly string[]): PathAnalysisFinding[] {
  if (requiredPortalIds.length === 0 || samples.length === 0) return [];
  const observed = observedPortalIds(project, samples);
  if (observed.length === requiredPortalIds.length && observed.every((visit, index) => visit.id === requiredPortalIds[index])) return [];
  const mismatchIndex = requiredPortalIds.findIndex((id, index) => observed[index]?.id !== id);
  const sampleIndex = mismatchIndex >= 0 ? (observed[mismatchIndex]?.sampleIndex ?? 0) : (observed.at(-1)?.sampleIndex ?? 0);
  return [{
    id: "geometry:ordered-traversal-mismatch",
    severity: "error",
    kind: "geometry",
    message: `The route must visit ${requiredPortalIds.join(" → ")} in that exact order; the generated path visits ${observed.map((visit) => visit.id).join(" → ") || "no typed portal"}.`,
    sample: sampleReference(path, samples, sampleIndex),
    sourcePath: "request.steps[].traversal",
  }];
}

export function minimumPathClearance(project: BordeauxProject, samples: readonly TrajectorySample[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const footprint = robotFootprintAt(project.robot, sample);
    minimum = Math.min(minimum, footprintBoundsClearance(footprint, FIELD_W, FIELD_H));
    for (const obstacle of appObstacleBounds()) {
      minimum = Math.min(minimum, convexPolygonClearance(footprint, boundsPolygon(obstacle)));
    }
  }
  REBUILT_2026_FIELD.crossingBarriers.forEach((barrier) => {
    const barrierX = officialToAppPoint({ x: barrier.x, y: 0 }).x;
    for (const sample of samples) {
      const footprint = robotFootprintAt(project.robot, sample);
      const footprintBounds = polygonBounds(footprint);
      const section = verticalLineSection(footprint, barrierX);
      const occupied = section ?? { minY: footprintBounds.min.y, maxY: footprintBounds.max.y };
      const lateral = barrier.portals.reduce((best, portal) => {
        const bounds = portalBounds(portal);
        return Math.max(best, Math.min(occupied.minY - bounds.minY, bounds.maxY - occupied.maxY));
      }, Number.NEGATIVE_INFINITY);
      if (section) minimum = Math.min(minimum, lateral);
      else if (lateral < 0) {
        const longitudinal = barrierX < footprintBounds.min.x
          ? footprintBounds.min.x - barrierX
          : barrierX > footprintBounds.max.x ? barrierX - footprintBounds.max.x : 0;
        minimum = Math.min(minimum, longitudinal);
      }
    }
    let previousIndex = -1;
    let previousSide = 0;
    samples.forEach((sample, index) => {
      const delta = sample.x - barrierX;
      const side = Math.abs(delta) <= EPSILON ? 0 : Math.sign(delta);
      if (side === 0) return;
      if (previousIndex >= 0 && previousSide !== side) {
        const previous = samples[previousIndex];
        const pose = crossingPose(previous, sample, barrierX);
        const section = footprintSectionAt(project, pose, barrierX);
        const portalClearance = barrier.portals.reduce((best, portal) => {
          if (!section) return best;
          const bounds = portalBounds(portal);
          return Math.max(best, Math.min(section.minY - bounds.minY, bounds.maxY - section.maxY));
        }, Number.NEGATIVE_INFINITY);
        minimum = Math.min(minimum, portalClearance);
      }
      previousIndex = index;
      previousSide = side;
    });
  });
  return Number.isFinite(minimum) ? minimum : 0;
}

function analyzeGeneratedPath(
  project: BordeauxProject,
  path: PathDoc,
  plannerId: TrajectoryPlannerId,
  samples: readonly TrajectorySample[],
  plannerDiagnostics: ValidationIssue[],
  sampleLimit: number,
  minimumClearanceM: number,
  robotHeightM?: number,
  requiredTraversal?: AnalyzePathOptions["requiredTraversal"],
  requiredPortalIds: readonly string[] = [],
): Pick<PathAnalysis, "rawSamples" | "samplesTruncated" | "extrema" | "findings"> {
  const values = measuredValues(samples);
  const waypointDistances = waypointArrivalIndices(path, samples).map((index) => samples[index].s);
  const extrema: PathAnalysisExtremum[] = [];
  const retainedIndices = new Set<number>();
  retainWaypointArrivals(path, samples, retainedIndices);
  const metrics: PathAnalysisMetric[] = ["velocity", "acceleration", "deceleration", "angularVelocity", "angularAcceleration", "angularDeceleration", "jerk", "angularJerk", "curvature"];
  metrics.forEach((metric) => {
    const measured = maxBy(values, metric);
    if (!measured) return;
    retainedIndices.add(measured.sampleIndex);
    extrema.push({ metric, value: measured.value, unit: measured.unit, sample: sampleReference(path, samples, measured.sampleIndex) });
  });

  const findings: PathAnalysisFinding[] = [];
  findings.push(...barrierCrossingFindings(project, path, samples, robotHeightM, requiredTraversal));
  findings.push(...requiredPortalSequenceFindings(project, path, samples, requiredPortalIds));
  const checkedMetrics: PathAnalysisMetric[] = ["velocity", "acceleration", "deceleration", "angularVelocity", "angularAcceleration", "angularDeceleration", "jerk", "angularJerk"];
  checkedMetrics.forEach((metric) => {
    const violation = values.filter((item) => item.metric === metric).reduce<{ measured: MeasuredValue; limit: number; source: string; ratio: number } | undefined>((worst, measured) => {
      const active = metricLimit(path, samples[measured.sampleIndex], samples.at(-1)?.s ?? 0, waypointDistances, metric);
      if (active.limit === undefined || measured.value <= active.limit + Math.max(EPSILON, active.limit * 1e-3)) return worst;
      const candidate = { measured, limit: active.limit, source: active.source, ratio: measured.value / active.limit };
      return !worst || candidate.ratio > worst.ratio ? candidate : worst;
    }, undefined);
    if (!violation) return;
    const { measured, limit, source } = violation;
    retainedIndices.add(measured.sampleIndex);
    findings.push({
      id: `constraint:${metric}`,
      severity: "error",
      kind: "constraint",
      metric,
      measured: measured.value,
      limit,
      unit: measured.unit,
      sample: sampleReference(path, samples, measured.sampleIndex),
      sourcePath: source,
      message: `${metric} reaches ${measured.value.toFixed(3)} ${measured.unit}, above the authored ${limit.toFixed(3)} ${measured.unit} limit.`,
    });
  });

  if (plannerId === "labviewBezier" || plannerId === "labviewClothoid") {
    const motorViolation = samples.reduce<{ index: number; measured: number; limit: number; ratio: number } | undefined>((worst, sample, index) => {
      if (index === 0 || sample.accelerationMps2 <= 0) return worst;
      const active = metricLimit(path, sample, samples.at(-1)?.s ?? 0, waypointDistances, "acceleration").limit ?? path.constraints.maxAccel;
      const limit = active * Math.max(0, Math.min(1, 1 - Math.abs(samples[index - 1].velocityMps) / project.robot.maxSpeed));
      if (sample.accelerationMps2 <= limit + Math.max(EPSILON, active * 1e-3)) return worst;
      const candidate = { index, measured: sample.accelerationMps2, limit, ratio: sample.accelerationMps2 / Math.max(limit, EPSILON) };
      return !worst || candidate.ratio > worst.ratio ? candidate : worst;
    }, undefined);
    if (motorViolation) {
      retainedIndices.add(motorViolation.index);
      findings.push({ id: "constraint:motor-envelope", severity: "error", kind: "constraint", metric: "acceleration", measured: motorViolation.measured, limit: motorViolation.limit, unit: "m/s²", sample: sampleReference(path, samples, motorViolation.index), sourcePath: "robot.maxSpeed", message: `Acceleration reaches ${motorViolation.measured.toFixed(3)} m/s² above the ${motorViolation.limit.toFixed(3)} m/s² motor free-speed envelope.` });
    }
  }

  const clearance = minimumPathClearance(project, samples);
  if (clearance < minimumClearanceM) {
    const closestIndex = samples.reduce((bestIndex, sample, index) => {
      const singleton = minimumPathClearance(project, [sample]);
      return singleton < minimumPathClearance(project, [samples[bestIndex]]) ? index : bestIndex;
    }, 0);
    retainedIndices.add(closestIndex);
    findings.push({
      id: "geometry:field-obstacle-clearance",
      severity: clearance < 0 ? "error" : "warning",
      kind: "geometry",
      measured: clearance,
      limit: minimumClearanceM,
      unit: "m",
      sample: sampleReference(path, samples, closestIndex),
      sourcePath: "field.2026-rebuilt.solidObstacles",
      message: clearance < 0
        ? `The robot footprint intersects a solid field element by ${Math.abs(clearance).toFixed(3)} m.`
        : `Minimum field-element clearance is ${clearance.toFixed(3)} m, below the requested ${minimumClearanceM.toFixed(3)} m.`,
    });
  }

  plannerDiagnostics.forEach((diagnostic, index) => findings.push({
    id: `planner:${index}`,
    severity: /^(Tight curvature|Velocity dip)/.test(diagnostic.message) ? "note" : diagnostic.severity,
    kind: "planner",
    message: diagnostic.message,
    sourcePath: diagnostic.path,
  }));

  return {
    rawSamples: downsample(samples, sampleLimit, retainedIndices),
    samplesTruncated: samples.length > sampleLimit,
    extrema,
    findings,
  };
}

export function analyzePath(project: BordeauxProject, pathId: string, options: AnalyzePathOptions = {}): PathAnalysis {
  const projectClone = clone(project);
  const pathIndex = projectClone.paths.findIndex((candidate) => candidate.id === pathId);
  if (pathIndex < 0) throw new Error(`Path ${pathId} does not exist in the current project.`);
  const path = projectClone.paths[pathIndex];
  const plannerId = options.plannerId ?? projectClone.plannerId ?? "profiledSpline";
  const structural = validateProject(projectClone).issues.filter((item) => item.path.startsWith(`$.paths[${pathIndex}]`));
  let generated;
  try {
    generated = getPlanner(plannerId).generate({ path, robot: projectClone.robot, plannerId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const structureFindings: PathAnalysisFinding[] = structural.map((item, index) => ({
      id: `structure:${index}`,
      severity: item.severity,
      kind: "structure",
      message: item.message,
      sourcePath: item.path,
    }));
    return {
      pathId: path.id,
      pathName: path.name,
      authoredPath: clone(path),
      planner: plannerId,
      totalTimeS: null,
      totalDistanceM: null,
      sampleCount: 0,
      samplesTruncated: false,
      rawSamples: [],
      extrema: [],
      findings: structureFindings.concat({
        id: "planner:generation-failed",
        severity: "error",
        kind: "planner",
        message: `Planner generation failed: ${message}`,
        sourcePath: `$.paths[${pathIndex}]`,
      }),
      plannerDiagnostics: [],
    };
  }
  const measured = analyzeGeneratedPath(
    projectClone,
    path,
    plannerId,
    generated.samples,
    generated.diagnostics,
    Math.max(50, Math.min(2_000, options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT)),
    Math.max(0, Math.min(2, options.minimumClearanceM ?? 0)),
    options.robotHeightM,
    options.requiredTraversal,
    options.requiredPortalIds,
  );
  const structureFindings: PathAnalysisFinding[] = structural.map((item, index) => ({
    id: `structure:${index}`,
    severity: item.severity,
    kind: "structure",
    message: item.message,
    sourcePath: item.path,
  }));
  return {
    pathId: path.id,
    pathName: path.name,
    authoredPath: clone(path),
    planner: generated.planner,
    totalTimeS: generated.totalTimeS,
    totalDistanceM: generated.totalDistanceM,
    sampleCount: generated.samples.length,
    plannerDiagnostics: generated.diagnostics.map((item) => ({ ...item })),
    optimization: generated.optimization,
    ...measured,
    findings: [...structureFindings, ...measured.findings],
  };
}
