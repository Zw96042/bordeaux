import { AUTO } from "../lib/routineModel";

export function processRoutinePreviewJob(job, buildRun = AUTO.buildRun) {
  const startedAt = performance.now();
  try {
    return {
      id: job.id,
      value: buildRun(job.routine, job.paths, job.robot, job.outcomes, job.plannerId),
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
  self.onmessage = (event) => self.postMessage(processRoutinePreviewJob(event.data));
}
