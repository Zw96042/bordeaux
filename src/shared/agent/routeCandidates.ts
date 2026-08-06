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

function routePath(project: BordeauxProject, base: PathDoc, name: string, points: FieldPointInput[], requestedCollectionSpans: readonly CollectionSpan[], finishHeadingDeg?: number, smoothGeometry = false): { path: PathDoc; collectionSpans: ActiveCollectionSpan[] } {
  const raw = points.map((point, index) => {
    const next = points[Math.min(points.length - 1, index + 1)];
    const previous = points[Math.max(0, index - 1)];
    const theta = point.headingDeg ?? Math.atan2(next.y - previous.y, next.x - previous.x) * 180 / Math.PI;
    const authored = point as FieldPointInput & { prevC?: { x: number; y: number }; nextC?: { x: number; y: number }; segType?: "bezier" | "line" | "arc" | "clothoid" };
    const segType: "bezier" | "line" | "arc" | "clothoid" = authored.segType
      ?? (smoothGeometry ? "clothoid" : base.waypoints[Math.min(index, base.waypoints.length - 1)]?.segType ?? "bezier");
    return {
      x: point.x, y: point.y, theta,
      segType,
      ...(authored.prevC ? { prevC: authored.prevC } : {}),
      ...(authored.nextC ? { nextC: authored.nextC } : {}),
    };
  });
  const waypoints = buildWaypoints(raw);
  waypoints.forEach((waypoint, index) => {
    const authored = points[index] as FieldPointInput & { prevC?: { x: number; y: number }; nextC?: { x: number; y: number } };
    const next = waypoints[index + 1];
    if (!authored.prevC || authored.nextC || !next) return;
    const dx = waypoint.x - authored.prevC.x;
    const dy = waypoint.y - authored.prevC.y;
    const length = Math.hypot(dx, dy);
    const capped = Math.min(length, Math.hypot(next.x - waypoint.x, next.y - waypoint.y) / 3);
    if (length > 1e-9) waypoint.nextC = { x: waypoint.x + dx / length * capped, y: waypoint.y + dy / length * capped };
  });
  waypoints.forEach((waypoint, index) => {
    const capHandle = (key: "prevC" | "nextC", neighborIndex: number) => {
      if ((points[index] as FieldPointInput & { prevC?: unknown; nextC?: unknown })[key]) return;
      const handle = waypoint[key];
      const neighbor = waypoints[neighborIndex];
      if (!handle || !neighbor) return;
      const handleLength = Math.hypot(handle.x - waypoint.x, handle.y - waypoint.y);
      const maximum = Math.hypot(neighbor.x - waypoint.x, neighbor.y - waypoint.y) / 3;
      if (handleLength <= maximum || handleLength <= 1e-9) return;
      const scale = maximum / handleLength;
      waypoint[key] = { x: waypoint.x + (handle.x - waypoint.x) * scale, y: waypoint.y + (handle.y - waypoint.y) * scale };
    };
    capHandle("prevC", index - 1);
    capHandle("nextC", index + 1);
  });
  const intake = project.robot.planning?.intake;
  if (requestedCollectionSpans.length > 0 && !intake) throw new Error("Configure the robot's intake location, direction, capture width, and collection speed before planning FUEL collection.");
  if (finishHeadingDeg !== undefined) {
    const endpoint = waypoints.at(-1)!;
    endpoint.stop = true;
    endpoint.theta = finishHeadingDeg;
    endpoint.thetaOn = true;
  }
  if (requestedCollectionSpans.length > 0) waypoints.slice(0, -1).forEach((waypoint) => { waypoint.segmentHeadingMode = "tangent"; });
  const path: PathDoc = {
    ...clone(base),
    id: createPathId(),
    name,
    folderId: base.folderId,
    waypoints,
    targets: [],
    markers: [],
    ranges: [],
    driveBackward: false,
    startVel: 0,
    goalVel: 0,
  };
  const collectionSpans = activeCollectionSpans(path, requestedCollectionSpans);
  path.ranges = collectionSpans.map((span) => ({
    anchor: "wp" as const,
    f0: 0,
    f1: 0,
    w0: span.startSegmentIndex,
    t0: span.startT,
    w1: span.endSegmentIndex,
    t1: span.endT,
    maxVel: Math.min(base.constraints.maxVel, intake?.maxCollectSpeedMps ?? base.constraints.maxVel),
    maxAccel: base.constraints.maxAccel,
    maxDecel: base.constraints.maxDecel,
    maxAngVel: base.constraints.maxAngVel,
    maxAngAccel: base.constraints.maxAngAccel,
    name: collectionSpans.length > 1 ? `FUEL collection ${collectionSpans.indexOf(span) + 1}` : "FUEL collection",
  }));
  if (intake) {
    configureCollectionHeading(path, collectionSpans, intake.directionDeg);
  }
  if (finishHeadingDeg !== undefined && path.waypoints.length > 1) {
    const finishStart = collectionSpans.length
      ? Math.min(path.waypoints.length - 2, Math.max(...collectionSpans.map((span) => span.endSegmentIndex)) + 1)
      : 0;
    path.waypoints[finishStart].thetaOn = true;
    for (let segment = finishStart; segment < path.waypoints.length - 1; segment += 1) path.waypoints[segment].segmentHeadingMode = "targets";
  }
  return { path, collectionSpans };
}

function traversalOptions(request: PlanPathRequest): RouteTraversal[] {
  switch (request.traversal) {
    case "trench": return ["trench-table", "trench-away"];
    case "bump": return ["bump-table", "bump-away"];
    case "compare": return ["direct", "trench-table", "trench-away", "bump-table", "bump-away"];
    default: return ["direct", "trench-table", "trench-away", "bump-table", "bump-away"];
  }
}

function legBarriers(start: FieldPointInput, goal: FieldPointInput) {
  return REBUILT_2026_FIELD.crossingBarriers
    .map((barrier) => ({ barrier, appX: officialToAppPoint({ x: barrier.x, y: 0 }).x }))
    .filter(({ appX }) => appX >= Math.min(start.x, goal.x) - 1e-6 && appX <= Math.max(start.x, goal.x) + 1e-6)
    .sort((left, right) => goal.x > start.x ? left.appX - right.appX : right.appX - left.appX);
}

function appendPoint(points: FieldPointInput[], point: FieldPointInput): void {
  const previous = points.at(-1);
  if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-6) points.push(point);
}

function appendLeg(points: FieldPointInput[], goal: FieldPointInput, traversal: RouteTraversal, enforceTraversal = false, portalRunM = 0): string[] {
  const start = points[points.length - 1];
  const requiredPortalIds: string[] = [];
  const barriers = legBarriers(start, goal);
  if (enforceTraversal && traversal === "direct" && barriers.length > 0) {
    throw new Error("An ordered leg that reaches an alliance barrier must name its exact TRENCH/BUMP and table/away traversal.");
  }
  if (traversal !== "direct") {
    const [kind, side] = traversal.split("-") as ["trench" | "bump", "table" | "away"];
    barriers.forEach(({ barrier, appX }) => {
      const portal = barrier.portals.find((candidate) => candidate.traversal === kind && candidate.side === side)!;
      requiredPortalIds.push(portal.id);
      const portalPoint = officialToAppPoint(portal.point);
      const direction = Math.sign(goal.x - start.x) || 1;
      const startsAtBarrier = Math.abs(start.x - appX) <= 1e-6;
      const endsAtBarrier = Math.abs(goal.x - appX) <= 1e-6;
      if (!startsAtBarrier) appendPoint(points, { x: appX - direction * portalRunM, y: portalPoint.y });
      if (!startsAtBarrier && !endsAtBarrier) appendPoint(points, portalPoint);
      const exitGuide = { x: appX + direction * portalRunM, y: portalPoint.y };
      if (!endsAtBarrier && Math.hypot(goal.x - exitGuide.x, goal.y - exitGuide.y) >= 0.4) appendPoint(points, exitGuide);
    });
  }
  if (enforceTraversal && traversal !== "direct" && requiredPortalIds.length === 0) {
    throw new Error(`The ordered leg requires ${traversal.replace("-", " ")} but does not reach an alliance barrier.`);
  }
  appendPoint(points, goal);
  return requiredPortalIds;
}

function assertPointInside(point: FieldPointInput, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > FIELD_W || point.y < 0 || point.y > FIELD_H) {
    throw new Error(`${label} extends outside Bordeaux's field bounds; reduce the maneuver radius or choose a different turn direction.`);
  }
}

function appendSwoosh(
  points: FieldPointInput[],
  farExtent: FieldPointInput,
  step: Extract<RouteStep, { kind: "swoosh" }>,
  portalRunM: number,
): string[] {
  if (!Number.isFinite(step.radiusM) || step.radiusM < 0.25 || step.radiusM > 2.5) throw new Error("A swoosh radius must be between 0.25 m and 2.5 m.");
  const previous = points[points.length - 1];
  const fuel = officialToAppRect(REBUILT_2026_INITIAL_FUEL_REGION);
  const targetsFuelEdge = Math.min(Math.abs(farExtent.x - fuel.xMin), Math.abs(farExtent.x - fuel.xMax)) < 0.03;
  const initialDirection = Math.sign(farExtent.x - previous.x) || 1;
  const nearEdge = targetsFuelEdge ? { x: initialDirection > 0 ? fuel.xMin : fuel.xMax, y: farExtent.y } : previous;
  const rawDx = farExtent.x - nearEdge.x;
  const rawDy = farExtent.y - nearEdge.y;
  const rawLength = Math.hypot(rawDx, rawDy);
  const insetM = step.insetM ?? 0;
  if (!Number.isFinite(insetM) || insetM < 0 || insetM > 2) throw new Error("A swoosh inset must be between 0 m and 2 m.");
  const far = rawLength > 1e-9 ? { x: farExtent.x - rawDx / rawLength * insetM, y: farExtent.y - rawDy / rawLength * insetM } : farExtent;
  const dx = far.x - nearEdge.x;
  const dy = far.y - nearEdge.y;
  const length = Math.hypot(dx, dy);
  if (length < step.radiusM + 0.1) throw new Error("A swoosh needs enough approach distance to establish its incoming direction.");
  const ux = dx / length;
  const uy = dy / length;
  const side = step.turn === "clockwise" ? 1 : -1;
  const nx = side * uy;
  const ny = side * -ux;
  // `at` is the far longitudinal extent. These three points form a smooth,
  // deterministic 180-degree reversal without inventing an arbitrary loop.
  const entry = { x: far.x - ux * step.radiusM, y: far.y - uy * step.radiusM };
  const outer = { x: far.x + nx * step.radiusM, y: far.y + ny * step.radiusM };
