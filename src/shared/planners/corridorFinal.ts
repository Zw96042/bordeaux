import { minimumRobotFieldClearance, observeRobotFieldPortalSequence } from "../agent/fieldClearance";
import { robotFootprintAt, robotFootprintRadius } from "../agent/robotFootprint";
import { PM } from "../math/pm";
import { clone } from "../project/defaults";
import type { ControlPoint, PathDoc, PlannerInput, PlannerOptimizationDiagnostics, PlannerResult } from "../types";
import { optimizeFixedGeometryFinal } from "./fixedGeometryFinal";
import { fixedPathSamples } from "./index";
import { validateOptimizedTrajectory } from "./trajectoryValidation";

const DEFAULT_CORRIDOR_M = 0.15;
const MIN_CORRIDOR_M = 0.03;
const MAX_CORRIDOR_M = 1.5;
const MAX_SEGMENTS = 40;
const MAX_EVALUATIONS = 72;
const MIN_GAIN_S = 0.02;
const MIN_GAIN_FRACTION = 0.005;
const EPSILON = 1e-6;

export interface CorridorGateBounds {
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}

export interface CorridorFinalOptions {
  corridorM?: number;
  minimumClearanceM?: number;
  gates?: readonly CorridorGateBounds[];
  budgetTier?: "common" | "stress" | "hard";
  budgetMs?: number;
  maximumEvaluations?: number;
  now?: () => number;
  isCancelled?: () => boolean;
}

interface Handle {
  waypointIndex: number;
  key: "prevC" | "nextC";
  chordM: number;
}

interface GeometryPoint extends ControlPoint {
  seg: number;
}

interface Evaluation {
  path: PathDoc;
  result: PlannerResult;
  maxDeviationM: number;
  minimumClearanceM: number;
}

function distance(first: ControlPoint, second: ControlPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function pointSegmentDistance(point: ControlPoint, first: ControlPoint, second: ControlPoint): number {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return distance(point, first);
  const progress = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared));
  return Math.hypot(point.x - first.x - dx * progress, point.y - first.y - dy * progress);
}

function pointsBySegment(points: readonly GeometryPoint[]): Map<number, GeometryPoint[]> {
  const result = new Map<number, GeometryPoint[]>();
  points.forEach((point) => {
    const segment = result.get(point.seg) ?? [];
    segment.push(point);
    result.set(point.seg, segment);
  });
  return result;
}

function directedDeviation(points: readonly GeometryPoint[], reference: ReadonlyMap<number, readonly GeometryPoint[]>): number {
  let maximum = 0;
  for (const point of points) {
    const segment = reference.get(point.seg);
    if (!segment || segment.length < 2) return Number.POSITIVE_INFINITY;
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < segment.length; index += 1) {
      nearest = Math.min(nearest, pointSegmentDistance(point, segment[index - 1], segment[index]));
    }
    maximum = Math.max(maximum, nearest);
  }
  return maximum;
}

function routeDeviation(reference: readonly GeometryPoint[], candidate: readonly GeometryPoint[]): number {
  return Math.max(
    directedDeviation(candidate, pointsBySegment(reference)),
    directedDeviation(reference, pointsBySegment(candidate)),
  );
}

function distanceToRoute(point: ControlPoint, reference: readonly GeometryPoint[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < reference.length; index += 1) {
    nearest = Math.min(nearest, pointSegmentDistance(point, reference[index - 1], reference[index]));
  }
  return nearest;
}

function sweptFootprintInsideCorridor(
  input: PlannerInput,
  samples: PlannerResult["samples"],
  reference: readonly GeometryPoint[],
  corridorM: number,
): boolean {
  const boundaryM = robotFootprintRadius(input.robot) + corridorM;
  return samples.every((sample) => robotFootprintAt(input.robot, sample)
    .every((vertex) => distanceToRoute(vertex, reference) <= boundaryM + EPSILON));
}

function passesGates(samples: PlannerResult["samples"], gates: readonly CorridorGateBounds[]): boolean {
  let cursor = 0;
  for (const gate of gates) {
    let found = -1;
    for (let index = cursor; index < samples.length; index += 1) {
      const sample = samples[index];
      if (sample.x >= gate.bounds.xMin - EPSILON && sample.x <= gate.bounds.xMax + EPSILON
        && sample.y >= gate.bounds.yMin - EPSILON && sample.y <= gate.bounds.yMax + EPSILON) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    cursor = found;
  }
  return true;
}

function movableHandles(path: PathDoc): Handle[] {
  const handles: Handle[] = [];
  path.waypoints.slice(0, -1).forEach((waypoint, segmentIndex) => {
    const next = path.waypoints[segmentIndex + 1];
    if ((waypoint.segType ?? "bezier") !== "bezier") return;
    if (waypoint.nextC && distance(waypoint, waypoint.nextC) > EPSILON) {
      handles.push({ waypointIndex: segmentIndex, key: "nextC", chordM: distance(waypoint, next) });
    }
    if (next.prevC && distance(next, next.prevC) > EPSILON) {
      handles.push({ waypointIndex: segmentIndex + 1, key: "prevC", chordM: distance(waypoint, next) });
    }
  });
  return handles;
}

function setHandleLength(path: PathDoc, handle: Handle, lengthM: number): void {
  const waypoint = path.waypoints[handle.waypointIndex];
  const control = waypoint[handle.key];
  if (!control) return;
  const currentM = distance(waypoint, control);
  if (currentM <= EPSILON) return;
  waypoint[handle.key] = {
    x: waypoint.x + (control.x - waypoint.x) / currentM * lengthM,
    y: waypoint.y + (control.y - waypoint.y) / currentM * lengthM,
  };
}

function corridorDiagnostics(
  result: PlannerResult,
  options: Required<Pick<CorridorFinalOptions, "budgetTier" | "budgetMs">>,
  patch: Partial<PlannerOptimizationDiagnostics>,
): PlannerOptimizationDiagnostics {
  const source = result.optimization ?? {
    plannerUsed: result.planner,
    solveTimeMs: 0,
    totalTimeS: result.totalTimeS,
    maxVelocityMps: Math.max(...result.samples.map((sample) => Math.abs(sample.velocityMps))),
    maxAccelerationMps2: Math.max(...result.samples.map((sample) => Math.abs(sample.accelerationMps2))),
    constraintViolations: 0,
    fallback: false,
  };
  return {
    ...source,
    optimizationClass: "corridor",
    budgetTier: options.budgetTier,
    budgetMs: options.budgetMs,
    ...patch,
  };
}

function fallback(
  baseline: PlannerResult,
  options: Required<Pick<CorridorFinalOptions, "budgetTier" | "budgetMs">>,
  evaluations: number,
  status: "equivalent" | "cancelled" | "internal-error",
  reason?: string,
): PlannerResult {
  return {
    ...baseline,
    optimization: corridorDiagnostics(baseline, options, {
      plannerUsed: baseline.planner,
      status,
      totalTimeS: baseline.totalTimeS,
      constraintViolations: 0,
      fallback: status !== "equivalent",
      fallbackReason: reason,
      evaluations,
      maxDeviationM: 0,
    }),
  };
}

/**
 * Deterministically searches Bezier handle lengths inside an authored swept-
 * footprint corridor. Waypoint positions, handle directions, stops, markers,
 * and the input path remain immutable.
 */
export function optimizeCorridorFinal(input: PlannerInput, requested: CorridorFinalOptions = {}): PlannerResult {
  const now = requested.now ?? (() => performance.now());
  const budgetTier = requested.budgetTier ?? "common";
  const budgetMs = Math.max(1, Math.min(30_000, requested.budgetMs
    ?? (budgetTier === "hard" ? 30_000 : budgetTier === "stress" ? 15_000 : 5_000)));
  const diagnosticsOptions = { budgetTier, budgetMs };
  const corridorM = Math.max(MIN_CORRIDOR_M, Math.min(MAX_CORRIDOR_M, requested.corridorM ?? DEFAULT_CORRIDOR_M));
  const minimumClearanceM = Math.max(0, Math.min(0.5, requested.minimumClearanceM ?? 0));
  const maximumEvaluations = Math.max(1, Math.min(MAX_EVALUATIONS, requested.maximumEvaluations ?? MAX_EVALUATIONS));
  const startedAt = now();
  const authored = clone(input.path);
  const baseline = optimizeFixedGeometryFinal({ ...input, path: authored });
  const baselineTopology = observeRobotFieldPortalSequence(input.robot, baseline.samples);
  let evaluations = 0;
  let budgetFailure: "cancelled" | "deadline" | null = null;
  const canEvaluate = () => {
    if (requested.isCancelled?.()) { budgetFailure = "cancelled"; return false; }
    if (now() - startedAt >= budgetMs) { budgetFailure = "deadline"; return false; }
    return evaluations < maximumEvaluations;
  };
  const failForBudget = () => fallback(
    baseline,
    diagnosticsOptions,
    evaluations,
    "cancelled",
    budgetFailure === "cancelled"
      ? "Corridor optimization was cancelled."
      : `Corridor optimization reached the ${budgetTier} solve budget (${budgetMs} ms).`,
  );

  if (baseline.optimization?.fallback) {
    return fallback(baseline, diagnosticsOptions, evaluations, "internal-error", baseline.optimization.fallbackReason ?? "The fixed-path baseline is invalid.");
  }
  if (!baselineTopology.valid) {
    return fallback(baseline, diagnosticsOptions, evaluations, "internal-error", "The authored path does not establish an unambiguous typed-portal sequence.");
  }
  if (authored.waypoints.length < 2 || authored.waypoints.length - 1 > MAX_SEGMENTS) {
    return fallback(baseline, diagnosticsOptions, evaluations, "internal-error", `Corridor optimization supports 1-${MAX_SEGMENTS} segments.`);
  }
  if (authored.waypoints.slice(0, -1).some((waypoint) => (waypoint.segType ?? "bezier") !== "bezier")) {
    return fallback(baseline, diagnosticsOptions, evaluations, "equivalent", "Corridor optimization currently supports all-Bezier paths.");
  }
  if (authored.waypoints.some((waypoint) => waypoint.jiggle)) {
    return fallback(baseline, diagnosticsOptions, evaluations, "equivalent", "Corridor optimization keeps paths with jiggle actions on their authored geometry.");
  }

  const samplesPerSegment = input.samplesPerSegment ?? 56;
  const reference = PM.sample(authored.waypoints, Math.max(128, samplesPerSegment * 2)).pts as GeometryPoint[];
  const handles = movableHandles(authored);
  if (handles.length === 0) return fallback(baseline, diagnosticsOptions, evaluations, "equivalent", "The path has no movable Bezier handles.");

  const evaluate = (path: PathDoc): Evaluation | null => {
    if (!canEvaluate()) return null;
    evaluations += 1;
    const route = PM.sample(path.waypoints, Math.max(128, samplesPerSegment * 2)).pts as GeometryPoint[];
    const maxDeviationM = routeDeviation(reference, route);
    if (!Number.isFinite(maxDeviationM) || maxDeviationM > corridorM + EPSILON) return null;
    const result = optimizeFixedGeometryFinal({ ...input, path });
    if (result.optimization?.fallback || result.diagnostics.some((issue) => issue.severity === "error")) return null;
    if (validateOptimizedTrajectory({ ...input, path }, fixedPathSamples(result), { angularKinematics: "sample" }).violations.length > 0) return null;
    const topology = observeRobotFieldPortalSequence(input.robot, result.samples);
    if (!topology.valid
      || topology.visits.length !== baselineTopology.visits.length
      || topology.visits.some((visit, index) => visit.id !== baselineTopology.visits[index].id)) return null;
    if (!passesGates(result.samples, requested.gates ?? [])) return null;
    if (!sweptFootprintInsideCorridor(input, result.samples, reference, corridorM)) return null;
    const clearanceM = minimumRobotFieldClearance(input.robot, result.samples);
    if (clearanceM < minimumClearanceM - EPSILON) return null;
    return { path, result, maxDeviationM, minimumClearanceM: clearanceM };
  };

  let best: Evaluation = {
    path: authored,
    result: baseline,
    maxDeviationM: 0,
    minimumClearanceM: minimumRobotFieldClearance(input.robot, baseline.samples),
  };
  const snapshot = (): PlannerResult => {
    const gainS = baseline.totalTimeS - best.result.totalTimeS;
    const improved = best.path !== authored && gainS >= Math.max(MIN_GAIN_S, baseline.totalTimeS * MIN_GAIN_FRACTION);
    const retained = improved ? best.result : baseline;
    return {
      ...retained,
      ...(improved ? { optimizedPath: clone(best.path) } : {}),
      optimization: corridorDiagnostics(retained, diagnosticsOptions, {
        status: improved ? "feasible" : "equivalent",
        termination,
        solveTimeMs: performance.now() - startedAt,
        totalTimeS: retained.totalTimeS,
        baselineTimeS: baseline.totalTimeS,
        gainS: improved ? gainS : 0,
        fallback: false,
        fallbackReason: improved ? undefined : `No material improvement was found inside the ${corridorM.toFixed(2)} m corridor.`,
        evaluations,
        validatedCandidates,
        rejectedCandidates,
        rejectionReasons: [...rejectionReasons].map(([reason, count]) => ({ reason, count })),
        maxDeviationM: improved ? best.maxDeviationM : 0,
        minimumClearanceM: improved ? best.minimumClearanceM : baselineClearanceM,
      }),
    };
  };
  const reject = (reason: string): null => {
    rejectedCandidates += 1;
    // Bound payload size even when each rejection has a different error.
    const key = rejectionReasons.has(reason) || rejectionReasons.size < 7 ? reason : "Other validation failures";
    rejectionReasons.set(key, (rejectionReasons.get(key) ?? 0) + 1);
    return null;
  };
  requested.onProgress?.(snapshot());
  const evaluate = (path: PathDoc): Evaluation | null => {
    if (!canEvaluate()) return null;
    const evaluationStartedAt = performance.now();
    evaluations += 1;
    try {
      const route = PM.sample(path.waypoints, Math.max(128, samplesPerSegment * 2)).pts as GeometryPoint[];
      const maxDeviationM = routeDeviation(reference, route);
      if (!Number.isFinite(maxDeviationM) || maxDeviationM > corridorM + EPSILON) return reject("Outside the authored corridor");
      // Candidate generation already performs dense physical validation.
      const result = getPlanner("optimizedTrajectory").generate({ ...input, path });
      if (result.optimization?.fallback || result.diagnostics.some((issue) => issue.severity === "error")) {
        return reject((result.optimization?.fallbackReason
          ?? result.diagnostics.find((issue) => issue.severity === "error")?.message
          ?? "Candidate generation failed").slice(0, 240));
      }
      const physicalPath = { ...path, constraints: effectivePathConstraints(path.constraints, physicalRobot) };
      const validation = validateOptimizedTrajectory(
        { ...input, path: physicalPath, robot: physicalRobot },
        fixedPathSamples(result),
        { angularKinematics: "sample" },
      );
      if (validation.violations.length > 0) return reject(validation.violations[0].message.slice(0, 240));
      const topology = observeRobotFieldPortalSequence(input.robot, result.samples);
      if (!topology.valid
        || topology.visits.length !== baselineTopology.visits.length
        || topology.visits.some((visit, index) => visit.id !== baselineTopology.visits[index].id)) return reject("Changed the authored portal sequence");
      if (!passesGates(result.samples, requested.gates ?? [])) return reject("Missed a required gate");
      if (!sweptFootprintInsideCorridor(input, result.samples, reference, corridorM)) return reject("Robot footprint leaves the corridor");
      const clearanceM = minimumRobotFieldClearance(input.robot, result.samples);
      if (clearanceM < minimumClearanceM - EPSILON) return reject("Insufficient field clearance");
      validatedCandidates += 1;
      const candidate = { path, result, maxDeviationM, minimumClearanceM: clearanceM };
      if (result.totalTimeS < best.result.totalTimeS - EPSILON) best = candidate;
      return candidate;
    } catch (error) {
      return reject((error instanceof Error ? error.message : "Candidate evaluation failed").slice(0, 240));
    } finally {
      longestEvaluationMs = Math.max(longestEvaluationMs, performance.now() - evaluationStartedAt);
      requested.onProgress?.(snapshot());
    }
  };

  const patterns = [
    (index: number) => index % 2 ? 1.18 : 0.82,
    (_index: number) => 0.82,
    (_index: number) => 1.18,
    (index: number) => index % 2 ? 0.82 : 1.18,
  ];
  for (let patternIndex = 0; patternIndex < patterns.length && canEvaluate(); patternIndex += 1) {
    const path = clone(authored);
    handles.forEach((handle, index) => {
      const waypoint = authored.waypoints[handle.waypointIndex];
      const control = waypoint[handle.key]!;
      const originalM = distance(waypoint, control);
      const requestedM = originalM * patterns[patternIndex](index);
      const corridorLimitedM = Math.max(originalM - corridorM, Math.min(originalM + corridorM, requestedM));
      setHandleLength(path, handle, Math.max(0.05, Math.min(handle.chordM * 1.5, corridorLimitedM)));
    });
    evaluate(path);
  }

  let local = best;
  for (let pass = 0; pass < 3 && canEvaluate(); pass += 1) {
    let improved = false;
    for (const handle of handles) {
      const waypoint = local.path.waypoints[handle.waypointIndex];
      const control = waypoint[handle.key]!;
      const currentM = distance(waypoint, control);
      const relativeStep = Math.max(0.015, Math.min(0.4, corridorM / Math.max(0.05, currentM)));
      let handleBest = local;
      for (const factor of [1 - relativeStep, 1 + relativeStep]) {
        if (!canEvaluate()) break;
        const path = clone(local.path);
        setHandleLength(path, handle, Math.max(0.05, Math.min(handle.chordM * 1.5, currentM * factor)));
        const candidate = evaluate(path);
        if (candidate && candidate.result.totalTimeS < handleBest.result.totalTimeS - EPSILON) handleBest = candidate;
      }
      if (handleBest !== local) { local = handleBest; improved = true; }
    }
    if (!improved) break;
  }

  termination ??= evaluations >= maximumEvaluations ? "work-budget" : "completed";
  return snapshot();
}
