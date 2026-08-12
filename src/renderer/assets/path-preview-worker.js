import { derivePlannerPreview } from "./optimized-preview";
import { buildRoutineRun } from "../lib/routineRun";
import { RoutinePreview } from "./routine-preview";

function derivePathPreview(path, robot, perSegment, plannerId) {
  return derivePlannerPreview(path, robot, perSegment, plannerId);
}

export function processPathPreviewJob(job, derive = derivePathPreview) {
  const startedAt = performance.now();
  try {
    return {
      id: job.id,
      quality: job.quality,
      value: derive(job.path, job.robot, job.perSegment, job.plannerId),
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
    : processPathPreviewJob(event.data));
}
