import { PM } from "../lib/pathMath";
import { optimizeCorridorFinal } from "../../shared/planners/corridorFinal";

function trajectoryAtGeometryPoint(samples, point, fraction) {
  let match = null;
  for (const sample of samples) {
    if (Math.abs(sample.f - fraction) > 1e-5
      || Math.hypot(sample.x - point.x, sample.y - point.y) > 1e-5) continue;
    if (!match || sample.t < match.t) match = sample;
  }
  if (!match) throw new Error('Final optimization did not preserve the renderer geometry.');
  return match;
}

function authoritativeActions(actions, kind, points, distance, finalTrajectory) {
  const available = (finalTrajectory.stationaryActions || []).filter((action) => action.kind === kind);
  const used = new Set();
  return (actions || []).map((action) => {
    const point = points[action.idx];
    const fraction = point ? Math.max(0, Math.min(1, point.s / distance)) : NaN;
    const index = available.findIndex((candidate, candidateIndex) => (
      !used.has(candidateIndex) && Math.abs(candidate.fraction - fraction) <= 1e-5
    ));
    if (index < 0) throw new Error(`Final optimization omitted ${kind} timing metadata.`);
    used.add(index);
    const timing = available[index];
    return {
      ...action,
      t0: timing.startTimeS,
      t1: timing.endTimeS,
      ...(kind === 'jiggle' ? { strokeDuration: timing.strokeDurationS } : {}),
    };
  });
}

/** Applies final timing to the immutable renderer geometry used for editing. */
export function applyFinalTrajectoryToPreview(derived, finalTrajectory) {
  const points = derived?.sample?.pts || [];
  const samples = finalTrajectory?.samples || [];
  if (points.length < 2 || samples.length < 2) throw new Error('Final optimization returned an incomplete trajectory.');
  const distance = derived.sample.length || points[points.length - 1].s || 1;
  const projected = points.map((point) => trajectoryAtGeometryPoint(
    samples,
    point,
    Math.max(0, Math.min(1, point.s / distance)),
    ordered,
  ));
  const times = projected.map((sample) => sample.t);
  const velocities = projected.map((sample) => sample.velocityMps);
  const accelerations = projected.map((sample) => sample.accelerationMps2);
  const angularVelocities = projected.map((sample) => sample.angularVelocityRadps);
  const headings = projected.map((sample) => sample.headingRad - (derived.rev ? Math.PI : 0));
  const curvatures = projected.map((sample) => sample.curvatureInvM);
  const maximumMagnitude = (values, floor) => values.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    floor,
  );
  const authoredTurns = authoritativeActions(
    rendererTurns(derived, finalTrajectory),
    'turn',
    points,
    finalTrajectory,
    derived.rev,
  );
  const headingCatchup = authoritativeHeadingCatchup(points, distance, finalTrajectory, derived.rev);
  return {
    ...derived,
    prof: {
      ...derived.prof,
      t: times,
      v: velocities,
      head: headings,
      totalTime: finalTrajectory.totalTimeS,
      holds: authoritativeActions(derived.prof.holds, 'wait', points, finalTrajectory, derived.rev),
      turns: headingCatchup ? [...authoredTurns, headingCatchup] : authoredTurns,
      jiggles: authoritativeActions(derived.prof.jiggles, 'jiggle', points, finalTrajectory, derived.rev),
    },
    metrics: {
      ...derived.metrics,
      head: headings,
      v: velocities,
      accel: accelerations,
      omega: angularVelocities,
      curv: curvatures,
      vMax: maximumMagnitude(velocities, 0.1),
      aMax: maximumMagnitude(accelerations, 0.1),
      wMax: maximumMagnitude(angularVelocities, 0.01),
      kMax: maximumMagnitude(curvatures, 0),
    },
    finalTrajectory,
    finalOptimization: finalTrajectory.optimization,
  };
}

function interactiveTrajectory(input) {
  return getPlanner('profiledSpline').generate(input);
}

/** Projects the exact selected result without rerunning the optimizer. */
export function previewForTrajectory(path, robot, trajectory, derive = PM.derivePath, perSegment = 56) {
  return applyFinalTrajectoryToPreview(
    derive(trajectory.optimizedPath || authoredPath(path), robot, perSegment, trajectory.planner),
    trajectory,
  );
}

export function processPathPreviewJob(
  job,
  derive = PM.derivePath,
  optimize = optimizeCorridorFinal,
  profile = interactiveTrajectory,
  emitProgress = () => {},
) {
  const startedAt = performance.now();
  try {
    const path = authoredPath(job.path);
    // Keep pointer editing on the low-latency geometry pass. Final planning
    // replaces it with the authoritative physics result after the edit settles.
    if (job.quality !== 'final') {
      return {
        id: job.id,
        quality: job.quality,
        value: derive(path, job.robot, job.perSegment, 'profiledSpline'),
        durationMs: performance.now() - startedAt,
      };
    }
    if (job.optimize === true) {
      const toPreview = (trajectory) => previewForTrajectory(path, job.robot, trajectory, derive, job.perSegment);
      const finalTrajectory = optimize(
        { path, robot: job.robot, field: job.field, samplesPerSegment: job.perSegment },
        {
          budgetTier: job.deadline,
          budgetMs: job.deadlineMs,
          corridorM: job.path.optimization?.corridorM ?? 0.15,
          onProgress: (trajectory) => emitProgress({
            id: job.id,
            type: 'progress',
            quality: job.quality,
            value: toPreview(trajectory),
            durationMs: performance.now() - startedAt,
          }),
        },
      );
      if (finalTrajectory.optimization?.fallback) {
        return {
          id: job.id,
          quality: job.quality,
          finalFallbackReason: finalTrajectory.optimization.fallbackReason || 'Final optimization did not produce a valid trajectory.',
          durationMs: performance.now() - startedAt,
        };
      }
      return {
        id: job.id,
        quality: job.quality,
        value: toPreview(finalTrajectory),
        durationMs: performance.now() - startedAt,
      };
    }
    const accepted = getAcceptedTrajectory(job.path, job.robot, job.field);
    const trajectory = accepted || profile({ path, robot: job.robot, field: job.field, samplesPerSegment: job.perSegment });
    const blockingDiagnostic = trajectory.diagnostics.find((issue) => issue.severity === 'error');
    if (blockingDiagnostic) throw new Error(blockingDiagnostic.message);
    const authoritative = previewForTrajectory(path, job.robot, trajectory, derive, job.perSegment);
    return {
      id: job.id,
      quality: job.quality,
      value: { ...authoritative, acceptedTrajectory: Boolean(accepted) },
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      id: job.id,
      quality: job.quality,
      error: {
        name: error && error.name ? error.name : 'Error',
        message: error && error.message ? error.message : String(error),
      },
      durationMs: performance.now() - startedAt,
    };
  }
}

export function processRoutinePreviewJob(job, buildRun = buildRoutineRun) {
  const startedAt = performance.now();
  try {
    const admission = RoutinePreview.workerRoutineAdmission(job.routine, job.paths, job.robot, job.outcomes);
    if (!admission.allowed) throw new RangeError(admission.error.message);
    return {
      id: job.id,
      value: buildRun(job.routine, job.paths, job.robot, job.outcomes, job.plannerId, derivePathPreview),
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      id: job.id,
      error: {
        name: error && error.name ? error.name : 'Error',
        message: error && error.message ? error.message : String(error),
      },
      durationMs: performance.now() - startedAt,
    };
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = (event) => self.postMessage(event.data?.kind === 'routine'
    ? processRoutinePreviewJob(event.data)
    : processPathPreviewJob(event.data, PM.derivePath, optimizeCorridorFinal, interactiveTrajectory, (progress) => self.postMessage(progress)));
}
