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
