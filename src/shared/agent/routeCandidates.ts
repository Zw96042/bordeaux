import { officialToAppPoint, officialToAppRect, REBUILT_2026_FIELD, REBUILT_2026_INITIAL_FUEL_REGION, REBUILT_2026_TRENCH_CLEARANCE_M } from "../field/rebuilt2026";
import { resolveProjectFieldTerm } from "../field/vocabulary";
import { FIELD_H, FIELD_W } from "../math/fieldBounds";
import { PM } from "../math/pm";
import { buildWaypoints, clone, createPathId } from "../project/defaults";
import type { BordeauxProject, PathDoc, TrajectoryPlannerId, TrajectorySample } from "../types";
import { analyzePath, minimumPathClearance } from "./pathAnalysis";
import { boundsPolygon, convexPolygonClearance, polygonBounds, robotFootprintAt, robotFootprintRadius } from "./robotFootprint";
import type { FieldPointInput, FuelCollectionIntent, PlanPathRequest, RouteCandidate, RouteLocationInput, RouteStep, RouteTraversal } from "./types";

const MAX_CANDIDATES = 5;

function isFieldTerm(input: RouteLocationInput): input is { term: string } {
  return "term" in input;
}

function resolveLocation(
  project: BordeauxProject,
  input: RouteLocationInput,
  request: PlanPathRequest,
  fallbackPose?: { x: number; y: number; physicalHeadingRad: number },
  allowReference = false,
): FieldPointInput {
  if (!isFieldTerm(input)) {
    if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > FIELD_W || input.y < 0 || input.y > FIELD_H || (input.headingDeg !== undefined && !Number.isFinite(input.headingDeg))) {
      throw new Error("Route coordinates must be finite and inside Bordeaux's field bounds; requested points are never silently clamped.");
    }
    return { ...input };
  }
  const resolved = resolveProjectFieldTerm(input.term, project.strategy, {
    alliance: request.alliance,
    robotHeightM: project.robot.heightM ?? request.robotHeightM,
    ...(fallbackPose ? { pose: { ...fallbackPose, headingSource: "physical" as const } } : {}),
  });
  if (resolved.status !== "resolved" || resolved.matches.length !== 1) {
    throw new Error(resolved.message ?? `“${input.term}” must resolve to exactly one field location.`);
  }
  const match = resolved.matches[0];
  if (!allowReference && match.navigable === false) throw new Error(`“${input.term}” is an official reference surface or fiducial, not a collision-free robot drive coordinate.`);
  const point = { ...match.point };
  if (match.id.includes("initial-fuel-") && fallbackPose) {
    const bounds = officialToAppRect(REBUILT_2026_INITIAL_FUEL_REGION);
    const margin = Math.min((bounds.yMax - bounds.yMin) / 2, robotFootprintRadius(project.robot) + 0.05);
    point.y = Math.max(bounds.yMin + margin, Math.min(bounds.yMax - margin, fallbackPose.y));
  }
  return { ...point, ...(match.headingDeg === undefined ? {} : { headingDeg: match.headingDeg }) };
}

function uniqueName(project: BordeauxProject, requested: string): string {
  const base = requested.trim() || "Agent path";
  const names = new Set(project.paths.map((path) => path.name.toLocaleLowerCase("en-US")));
  if (!names.has(base.toLocaleLowerCase("en-US"))) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase("en-US"))) suffix += 1;
  return `${base} ${suffix}`;
}

interface CollectionSpan {
  startWaypointIndex: number;
  endWaypointIndex: number;
  intent: FuelCollectionIntent;
}

interface ActiveCollectionSpan {
  startSegmentIndex: number;
  startT: number;
  endSegmentIndex: number;
  endT: number;
  f0: number;
  f1: number;
  intent: FuelCollectionIntent;
}

function sameCollectionIntent(left: FuelCollectionIntent, right: FuelCollectionIntent): boolean {
  return (left.maxHeadingErrorDeg ?? 5) === (right.maxHeadingErrorDeg ?? 5)
    && (left.allowCrosswiseHeading ?? false) === (right.allowCrosswiseHeading ?? false);
}

function unwrapNear(value: number, reference: number): number {
  return reference + Math.atan2(Math.sin(value - reference), Math.cos(value - reference));
}

function configureCollectionHeading(path: PathDoc, spans: readonly ActiveCollectionSpan[], intakeDirectionDeg: number): void {
  const alignedSegments = new Set<number>();
  spans.filter((span) => span.intent.allowCrosswiseHeading !== true).forEach((span) => {
    for (let segment = span.startSegmentIndex; segment <= span.endSegmentIndex; segment += 1) alignedSegments.add(segment);
  });
  if (alignedSegments.size === 0) return;
  const firstAlignedSegment = Math.min(...alignedSegments);
  const lastControlledSegment = Math.max(...alignedSegments);
  const intakeOffset = intakeDirectionDeg * Math.PI / 180;
  if (Math.abs(Math.atan2(Math.sin(intakeOffset), Math.cos(intakeOffset))) < 1e-6) {
    alignedSegments.forEach((segment) => { path.waypoints[segment].segmentHeadingMode = "tangent"; });
    return;
  }
  for (let segment = firstAlignedSegment; segment <= lastControlledSegment; segment += 1) path.waypoints[segment].segmentHeadingMode = "targets";
  const sampled = PM.sample(path.waypoints, 56);
  const points = sampled.pts as Array<{ s: number; seg: number; heading: number }>;
  const total = sampled.length || 1;
  const targets: PathDoc["targets"] = [];
  const first = points.findIndex((point) => point.seg >= firstAlignedSegment);
  let last = points.length - 1;
  for (let index = points.length - 1; index >= first; index -= 1) {
    if (alignedSegments.has(points[index].seg)) { last = index; break; }
  }
  const tangentDesired: number[] = [];
  for (let index = first; index <= last; index += 1) {
    const raw = points[index].heading - intakeOffset;
    tangentDesired.push(tangentDesired.length ? unwrapNear(raw, tangentDesired[tangentDesired.length - 1]) : raw);
  }
  let smoothed = [...tangentDesired];
  // Project a low-curvature heading law into each collection span's permitted
  // intake-error band. Non-collection approach samples remain free so the same
  // solve can blend continuously into a target-facing shooting pose.
  for (let pass = 0; pass < 320; pass += 1) {
    const next = [...smoothed];
    for (let local = 1; local < smoothed.length - 1; local += 1) {
      const relaxed = (smoothed[local - 1] + 2 * smoothed[local] + smoothed[local + 1]) / 4;
      const segment = points[first + local].seg;
      const active = spans.filter((span) => span.intent.allowCrosswiseHeading !== true && segment >= span.startSegmentIndex && segment <= span.endSegmentIndex);
      if (active.length === 0) next[local] = relaxed;
      else {
        const allowed = Math.max(0.25, Math.min(...active.map((span) => span.intent.maxHeadingErrorDeg ?? 5))) * Math.PI / 180;
        next[local] = Math.max(tangentDesired[local] - allowed, Math.min(tangentDesired[local] + allowed, relaxed));
      }
    }
    smoothed = next;
  }
  let lastAnchorLocal = -1;
  for (let local = 0; local < smoothed.length; local += 1) {
    const endpoint = local === 0 || local === smoothed.length - 1;
    const farEnough = lastAnchorLocal < 0 || points[first + local].s - points[first + lastAnchorLocal].s >= 0.3;
    const turnedEnough = lastAnchorLocal < 0 || Math.abs(smoothed[local] - smoothed[lastAnchorLocal]) >= 5 * Math.PI / 180;
    if (!endpoint && !farEnough && !turnedEnough) continue;
    const index = first + local;
    const fraction = points[index].s / total;
    const deg = smoothed[local] * 180 / Math.PI;
    if (fraction <= 1e-8) path.waypoints[0].theta = deg;
    else if (fraction >= 1 - 1e-8) path.waypoints[path.waypoints.length - 1].theta = deg;
    else targets.push({ f: fraction, deg });
    lastAnchorLocal = local;
  }
  path.targets = targets;
}

function activeCollectionSpans(path: PathDoc, requested: readonly CollectionSpan[]): ActiveCollectionSpan[] {
  if (requested.length === 0) return [];
  const sampled = PM.sample(path.waypoints, 120);
  const points = sampled.pts as Array<{ x: number; y: number; seg: number; t: number; s: number }>;
  const total = sampled.length || 1;
  const fuel = officialToAppRect(REBUILT_2026_INITIAL_FUEL_REGION);
  const insideFuel = (point: { x: number; y: number }) => point.x >= fuel.xMin - 0.01 && point.x <= fuel.xMax + 0.01 && point.y >= fuel.yMin - 0.01 && point.y <= fuel.yMax + 0.01;
  const active: ActiveCollectionSpan[] = [];
  requested.forEach((span) => {
    let first = -1;
    const flush = (last: number) => {
      if (first < 0 || last < first) return;
      const start = points[first];
      const end = points[last];
      active.push({
        startSegmentIndex: start.seg,
        startT: start.t,
        endSegmentIndex: end.seg,
        endT: end.t,
        f0: start.s / total,
        f1: end.s / total,
        intent: span.intent,
      });
      first = -1;
    };
    points.forEach((point, index) => {
      const inRequestedLeg = point.seg >= span.startWaypointIndex && point.seg < span.endWaypointIndex;
      if (inRequestedLeg && insideFuel(point)) {
        if (first < 0) first = index;
      } else flush(index - 1);
    });
    flush(points.length - 1);
  });
  return active;
}
