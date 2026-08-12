import { effectivePathConstraints } from "../../shared/robotLimits";
import { PathPreview } from "./path-preview";

// A run retains several arrays per derived sample and then clones that result
// back to the UI. Bound both derivation work and the result graph independently.
const MAX_WORKER_ROUTINE_WORK = 250_000;
const MAX_WORKER_OUTPUT_SAMPLES = 120_000;
const MAX_RENDERED_ROUTINE_SAMPLES = 120_000;
const MAX_WORKER_OUTPUT_STEPS = 2_000;
const MIN_SAMPLE_PERIOD = 0.01;
const EPSILON = 1e-9;
const MIN_SAFE_ANGULAR_VELOCITY = 90;
const MIN_SAFE_ANGULAR_ACCELERATION = 180;
const MIN_SAFE_ANGULAR_JERK = 360;
const MIN_SAFE_LINEAR_VELOCITY = 0.5;
const MIN_SAFE_LINEAR_ACCELERATION = 0.5;
const MAX_SAFE_JIGGLE_DISTANCE = 0.25;
const MAX_SAFE_JIGGLE_STROKES = 4;
const MAX_SAFE_TRANSLATION_SEGMENTS = 4;
const SAFE_TURN_SECONDS = 10;
const SAFE_JIGGLE_SECONDS = 8;
const SAFE_TRANSLATION_SECONDS_PER_SAMPLE = 4;
const ROUTINE_PREVIEW_LIMIT_MESSAGE = 'This routine is too large to preview safely. Reduce the number or complexity of its unique paths.';

function referencedPaths(routine, paths, outcomes) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const referenced = [];
  const seen = new Set();
  const collect = (nodes) => (nodes || []).forEach((node) => {
    if (node.type === 'decision') {
      collect((outcomes?.[node.id] || 'then') === 'else' ? node.else : node.then);
      return;
    }
    // Generated previews remain embedded on their routine node. Mixing them into
    // this authored-path lookup lets a preview with the same ID shadow the path.
    const path = node.type === 'path' ? byId.get(node.ref) : null;
    if (path && !seen.has(path)) { seen.add(path); referenced.push(path); }
  });
  collect(routine?.nodes);
  return referenced;
}

function walkSelected(nodes, outcomes, visit) {
  (nodes || []).forEach((node) => {
    visit(node);
    if (node.type === 'decision') {
      walkSelected((outcomes?.[node.id] || 'then') === 'else' ? node.else : node.then, outcomes, visit);
    }
  });
}

function directRoutineWork(routine, paths, perSegment = 56, outcomes = {}) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const unique = new Set();
  // Routine assembly and lookup still cost work even when every node reuses one path.
  // Weight each node conservatively so direct fallback stays comfortably below a frame.
  let total = byId.size;
  walkSelected(routine?.nodes, outcomes, (node) => {
    total += 16;
    const path = node.type === 'path'
      ? byId.get(node.ref)
      : node.type === 'function' && node.cat === 'generate' ? node.preview : null;
    if (!path || unique.has(path)) return;
    unique.add(path);
    total += PathPreview.directPreviewWork(path, perSegment);
  });
  return total;
}

function minimumConstraint(constraints, ranges, key, fallbackKey = key, allowZero = false) {
  const initial = Number(constraints[key] ?? constraints[fallbackKey]);
  if (!Number.isFinite(initial) || (allowZero ? initial < 0 : initial <= 0)) {
    throw new TypeError('Generated path preview constraints are incomplete.');
  }
  return (ranges || []).reduce((value, range) => {
    const candidate = Number(range?.[key] ?? range?.[fallbackKey] ?? value);
    if (!Number.isFinite(candidate) || (allowZero ? candidate < 0 : candidate <= 0)) {
      throw new TypeError('Generated path preview constraints are incomplete.');
    }
    return Math.min(value, candidate);
  }, initial);
}

function conservativeLimits(path, robot) {
  const constraints = robot ? effectivePathConstraints(path.constraints, robot) : path.constraints;
  const ranges = path.ranges || [];
  return {
    maxVel: minimumConstraint(constraints, ranges, 'maxVel'),
    maxAccel: minimumConstraint(constraints, ranges, 'maxAccel'),
    maxDecel: minimumConstraint(constraints, ranges, 'maxDecel', 'maxAccel'),
    maxAngVel: minimumConstraint(constraints, ranges, 'maxAngVel'),
    maxAngAccel: minimumConstraint(constraints, ranges, 'maxAngAccel'),
    maxAngDecel: minimumConstraint(constraints, ranges, 'maxAngDecel', 'maxAngAccel', true),
    maxAngJerk: Number(constraints.maxAngJerk ?? 0),
  };
}

function ticks(seconds) {
  return Math.ceil(seconds / MIN_SAMPLE_PERIOD - EPSILON);
}

function expandedSampleUpperBound(path, robot, perSegment) {
  if (!path || !path.constraints || !Array.isArray(path.waypoints)) {
    throw new TypeError('Generated path preview is incomplete.');
  }
  const limits = conservativeLimits(path, robot);
  const angularSafe = limits.maxAngVel >= MIN_SAFE_ANGULAR_VELOCITY
    && Math.min(limits.maxAngAccel, limits.maxAngDecel) >= MIN_SAFE_ANGULAR_ACCELERATION;
  let samples = 0;
  for (const waypoint of path.waypoints || []) {
    if (!Number.isFinite(waypoint.wait ?? 0) || (waypoint.wait ?? 0) < 0) {
      throw new TypeError('Generated path preview wait is invalid.');
    }
    if (waypoint.turnInPlace) {
      const jerkSafe = limits.maxAngJerk === 0 || limits.maxAngJerk >= MIN_SAFE_ANGULAR_JERK;
      if (!angularSafe || !jerkSafe) return Infinity;
      // With these lower limits, a forced full revolution takes under ten
      // seconds, including the shared planner's acceleration and jerk terms.
      samples += ticks(SAFE_TURN_SECONDS);
    }
    if (waypoint.jiggle && robot?.drive !== 'tank') {
      const { distanceM, strokes, strokeTimeS } = waypoint.jiggle;
      if (![distanceM, strokes, strokeTimeS].every(Number.isFinite) || distanceM <= 0
        || !Number.isInteger(strokes) || strokes <= 0 || strokeTimeS <= 0) {
        throw new TypeError('Generated path preview jiggle is invalid.');
      }
      const linearSafe = Math.min(limits.maxVel, robot?.maxSpeed ?? limits.maxVel) >= MIN_SAFE_LINEAR_VELOCITY
        && Math.min(limits.maxAccel, limits.maxDecel) >= MIN_SAFE_LINEAR_ACCELERATION;
      if (!linearSafe || distanceM > MAX_SAFE_JIGGLE_DISTANCE || strokes > MAX_SAFE_JIGGLE_STROKES) return Infinity;
      // At the admitted limits, eight seconds satisfies the shared planner's
      // free-speed/torque feasibility solve for a 0.25 m round trip.
      samples += ticks(Math.max(strokeTimeS, SAFE_JIGGLE_SECONDS)) * strokes;
    }
    samples += ticks(waypoint.wait ?? 0);
  }
  const translationPriority = path.ranges?.some((range) => range.rotationPriority === 'translation')
    || path.waypoints?.some((waypoint) => waypoint.headingTransition?.rotationPriority === 'translation');
  if (translationPriority && robot?.drive !== 'tank') {
    const segments = Math.max(0, path.waypoints.length - 1);
    if (!angularSafe || segments > MAX_SAFE_TRANSLATION_SEGMENTS) return Infinity;
    // Every unwrapped sample can add at most a half-turn. Four seconds per
    // sample bounds that turn from rest at the admitted angular floors; paths
    // above the small structural limit are rejected instead of approximated.
    samples += ticks(SAFE_TRANSLATION_SECONDS_PER_SAMPLE * perSegment) * segments;
  }
  return samples;
}

function workerRoutineEstimate(routine, paths, robot, outcomes = {}, perSegment = 56) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const sampleCounts = new Map();
  let outputSamples = 0;
  let outputItems = 0;
  let renderedSamples = 0;
  let stationarySamples = 0;
  let outputSteps = 0;
  walkSelected(routine?.nodes, outcomes, (node) => {
    outputSteps += 1;
    const path = node.type === 'path'
      ? byId.get(node.ref)
      : node.type === 'function' && node.cat === 'generate' ? node.preview : null;
    if (!path) return;
    let pathSamples = sampleCounts.get(path);
    if (pathSamples !== undefined) {
      renderedSamples += pathSamples;
      return;
    }
    const segments = Math.max(0, (path.waypoints?.length || 0) - 1);
    const geometrySamples = segments > 0 ? segments * perSegment + 1 : 0;
    // Bound planner expansions at the shared 10ms minimum sample period before
    // either structured clone or trajectory allocation begins.
    const added = expandedSampleUpperBound(path, robot, perSegment);
    pathSamples = geometrySamples + added;
    sampleCounts.set(path, pathSamples);
    outputSamples += pathSamples;
    renderedSamples += pathSamples;
    outputItems += pathSamples + (path.waypoints?.length || 0) + (path.targets?.length || 0)
      + (path.markers?.length || 0) + (path.ranges?.length || 0);
    stationarySamples += added;
  });
  return {
    work: workerRoutineWork(routine, paths, perSegment, outcomes) + stationarySamples,
    outputSamples,
    outputItems,
    renderedSamples,
    outputSteps,
  };
}

// Worker execution can safely process translation-priority paths; its terminal
// catch-up is bounded separately above. Direct fallback remains gated by the
// stricter PathPreview estimate and never runs that policy on the UI thread.
function workerRoutineWork(routine, paths, perSegment = 56, outcomes = {}) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const unique = new Set();
  let total = byId.size;
  walkSelected(routine?.nodes, outcomes, (node) => {
    total += 16;
    const path = node.type === 'path'
      ? byId.get(node.ref)
      : node.type === 'function' && node.cat === 'generate' ? node.preview : null;
    if (!path || unique.has(path)) return;
    unique.add(path);
    const segments = Math.max(0, (path.waypoints?.length || 0) - 1);
    const policyScans = Math.max(1, (path.ranges?.length || 0) + (path.targets?.length || 0)
      + (path.waypoints || []).filter((waypoint) => waypoint.headingTransition).length + 2);
    total += segments * perSegment * policyScans;
  });
  return total;
}

function workerRoutineAdmission(routine, paths, robot, outcomes = {}, perSegment = 56) {
  try {
    const estimate = workerRoutineEstimate(routine, paths, robot, outcomes, perSegment);
    const allowed = Number.isFinite(estimate.work)
      && estimate.work <= MAX_WORKER_ROUTINE_WORK
      && estimate.outputSamples <= MAX_WORKER_OUTPUT_SAMPLES
      && estimate.outputItems <= MAX_WORKER_OUTPUT_SAMPLES
      && estimate.renderedSamples <= MAX_RENDERED_ROUTINE_SAMPLES
      && estimate.outputSteps <= MAX_WORKER_OUTPUT_STEPS;
    return { allowed, estimate, error: allowed ? null : { name: 'RangeError', message: ROUTINE_PREVIEW_LIMIT_MESSAGE } };
  } catch (_error) {
    return {
      allowed: false,
      estimate: null,
      error: { name: 'RangeError', message: 'This routine contains a generated path preview that cannot be derived safely.' },
    };
  }
}

export const RoutinePreview = Object.freeze({ directRoutineWork, referencedPaths, workerRoutineAdmission, workerRoutineEstimate });
