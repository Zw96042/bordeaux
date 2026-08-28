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
