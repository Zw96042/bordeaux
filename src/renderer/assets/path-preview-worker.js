import { PM } from "../lib/pathMath";
import { optimizeFixedGeometryFinal } from "../../shared/planners/fixedGeometryFinal";

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
  ));
  const times = projected.map((sample) => sample.t);
  const velocities = projected.map((sample) => sample.velocityMps);
  const accelerations = projected.map((sample) => sample.accelerationMps2);
  const angularVelocities = projected.map((sample) => sample.angularVelocityRadps);
  const headings = projected.map((sample) => sample.headingRad - (derived.rev ? Math.PI : 0));
  const curvatures = projected.map((sample) => sample.curvatureInvM);
  return {
    ...derived,
    prof: {
      ...derived.prof,
      t: times,
      v: velocities,
      totalTime: finalTrajectory.totalTimeS,
      holds: authoritativeActions(derived.prof.holds, 'wait', points, distance, finalTrajectory),
      turns: authoritativeActions(derived.prof.turns, 'turn', points, distance, finalTrajectory),
      jiggles: authoritativeActions(derived.prof.jiggles, 'jiggle', points, distance, finalTrajectory),
    },
    metrics: {
      ...derived.metrics,
      head: headings,
      v: velocities,
      accel: accelerations,
      omega: angularVelocities,
      curv: curvatures,
    },
    finalTrajectory,
    finalOptimization: finalTrajectory.optimization,
  };
}

export function processPathPreviewJob(job, derive = PM.derivePath, optimize = optimizeFixedGeometryFinal) {
  const startedAt = performance.now();
  try {
    const value = derive(job.path, job.robot, job.perSegment, job.plannerId);
    if (job.quality === 'final' && job.plannerId === 'optimizedTrajectory') {
      const finalTrajectory = optimize({ path: job.path, robot: job.robot, samplesPerSegment: job.perSegment });
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
        value: applyFinalTrajectoryToPreview(value, finalTrajectory),
        durationMs: performance.now() - startedAt,
      };
    }
    return {
      id: job.id,
      quality: job.quality,
      value,
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

if (typeof self !== 'undefined') {
  self.onmessage = (event) => self.postMessage(processPathPreviewJob(event.data));
}
