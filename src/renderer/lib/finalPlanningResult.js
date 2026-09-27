export const UNVALIDATED_OPTIMIZATION = 'The selected optimization could not be validated. Review this path.';

/** Same rule as isOptimizationOutdated, for callers that already hold the path's current input key. */
export function optimizationOutdated(path, inputKey) {
  const key = path.optimization?.accepted?.inputKey;
  return typeof key === 'string' && key.length > 0 && key !== inputKey;
}

/**
 * The one reading of a planned trajectory for the selected result of a path.
 * A current applied optimization must be the validated selection; it never
 * falls back to normal planning silently.
 */
export function selectedTrajectoryOutcome(value, path, outdated, failure = 'Could not prepare this trajectory.') {
  if (path.optimization?.accepted && !outdated && !value?.acceptedTrajectory) {
    return { status: 'error', message: UNVALIDATED_OPTIMIZATION, unvalidated: true };
  }
  const seconds = value?.prof?.totalTime;
  return value?.finalTrajectory && Number.isFinite(seconds)
    ? { status: 'ready', value, seconds }
    : { status: 'error', message: failure };
}

/** Interprets a FinalPlanning result; timeouts, cancellation and fallbacks are failures here. */
export function finalPlanningOutcome(result, path, outdated) {
  return selectedTrajectoryOutcome(
    result?.status === 'success' ? result.value : null,
    path,
    outdated,
    result?.fallbackReason || result?.error?.message || 'Could not prepare this trajectory.',
  );
}

/** The library's duration entry for an outcome. */
export function durationResult(outcome) {
  if (outcome.status === 'ready') return { status: 'ready', seconds: outcome.seconds };
  return outcome.status === 'error' ? { status: 'error', message: outcome.message } : { status: 'pending' };
}
