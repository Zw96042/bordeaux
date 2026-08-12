import { PM } from "../lib/pathMath";
import { deriveOptimizedPreview } from "./optimized-preview";

function derivePathPreview(path, robot, perSegment, plannerId) {
  return plannerId === 'optimizedTrajectory'
    ? deriveOptimizedPreview(path, robot, perSegment)
    : PM.derivePath(path, robot, perSegment, 'profiledSpline');
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

if (typeof self !== 'undefined') {
  self.onmessage = (event) => self.postMessage(processPathPreviewJob(event.data));
}
