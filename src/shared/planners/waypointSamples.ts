import type { TrajectorySample, Waypoint } from "../types";

function coordinateKey(point: Pick<Waypoint, "x" | "y">): string {
  // Planner samples serialize geometry to four decimal places. Indexing the
  // authored coordinate at that same precision preserves the exact boundary.
  return `${Number(point.x.toFixed(4))},${Number(point.y.toFixed(4))}`;
}

interface CoordinateRun {
  start: number;
  end: number;
}

/**
 * Locates the ordered boundary sample retained for every authored waypoint.
 * Bordeaux planners preserve each waypoint at four-decimal sample precision.
 * Coordinate runs collapse stationary holds while retaining distinct departures
 * and returns, avoiding a trajectory rescan for every waypoint.
 */
export function orderedWaypointSampleIndices(
  waypoints: readonly Waypoint[],
  samples: readonly TrajectorySample[],
  options: {
    finalWaypointAtEnd?: boolean;
    fallback?: "bounded" | "full" | "stationary";
  } = {},
): number[] {
  if (samples.length === 0) return [];
  const sampleRunsByCoordinate = new Map<string, CoordinateRun[]>();
  let previousKey: string | undefined;
  samples.forEach((sample, index) => {
    const key = coordinateKey(sample);
    const runs = sampleRunsByCoordinate.get(key);
    if (key === previousKey) runs!.at(-1)!.end = index;
    else if (runs) runs.push({ start: index, end: index });
    else sampleRunsByCoordinate.set(key, [{ start: index, end: index }]);
    previousKey = key;
  });

  const remainingGroups = new Map<string, number>();
  for (let index = 0; index < waypoints.length;) {
    const key = coordinateKey(waypoints[index]);
    remainingGroups.set(key, (remainingGroups.get(key) ?? 0) + 1);
    index += 1;
    while (index < waypoints.length && coordinateKey(waypoints[index]) === key) index += 1;
  }
  const nextRunPositions = new Map<string, number>();

  let cursor = 0;
  const result: number[] = [];
  for (let waypointIndex = 0; waypointIndex < waypoints.length;) {
    const key = coordinateKey(waypoints[waypointIndex]);
    let groupEnd = waypointIndex;
    while (groupEnd + 1 < waypoints.length && coordinateKey(waypoints[groupEnd + 1]) === key) groupEnd += 1;
    const futureGroups = (remainingGroups.get(key) ?? 1) - 1;
    remainingGroups.set(key, futureGroups);
    const finalSearchIndex = options.fallback === "full"
      || options.fallback === "stationary"
      || waypointIndex === waypoints.length - 1
      ? samples.length - 1
      : Math.max(cursor, samples.length - (waypoints.length - waypointIndex));
    const runs = sampleRunsByCoordinate.get(key);
    let position = nextRunPositions.get(key) ?? 0;
    while (runs?.[position] && runs[position].end < cursor) position += 1;
    const run = runs?.[position];
    const finalOwnedRun = runs ? runs.length - futureGroups - 1 : -1;
    const start = run ? Math.max(cursor, run.start) : undefined;
    if (start !== undefined && start <= finalSearchIndex && position <= finalOwnedRun) {
      const groupSize = groupEnd - waypointIndex + 1;
      for (let offset = 0; offset < groupSize; offset += 1) {
        let index = start;
        if (groupSize > 1 && position === finalOwnedRun) {
          index = Math.round(start + (runs![finalOwnedRun].end - start) * offset / (groupSize - 1));
        } else if (groupSize > 1) {
          const runPosition = position + Math.floor((finalOwnedRun - position) * offset / (groupSize - 1));
          index = offset === groupSize - 1 ? runs![finalOwnedRun].end : runs![runPosition].start;
        }
        const currentWaypoint = waypointIndex + offset;
        if (options.finalWaypointAtEnd && currentWaypoint === waypoints.length - 1) index = samples.length - 1;
        result.push(index);
      }
      nextRunPositions.set(key, finalOwnedRun + 1);
      cursor = result.at(-1)!;
      waypointIndex = groupEnd + 1;
      continue;
    }

    for (; waypointIndex <= groupEnd; waypointIndex += 1) {
      if (options.finalWaypointAtEnd && waypointIndex === waypoints.length - 1) {
        result.push(samples.length - 1);
        cursor = samples.length - 1;
        continue;
      }
      const limit = options.fallback === "full"
        || options.fallback === "stationary"
        || waypointIndex === waypoints.length - 1
        ? samples.length - 1
        : Math.max(cursor, samples.length - (waypoints.length - waypointIndex));
      let nearest = cursor;
      let distance = Infinity;
      for (let candidate = cursor; candidate <= limit; candidate += 1) {
        const candidateDistance = Math.hypot(samples[candidate].x - waypoints[waypointIndex].x, samples[candidate].y - waypoints[waypointIndex].y);
        if (candidateDistance < distance) { nearest = candidate; distance = candidateDistance; }
        if (options.fallback === "stationary" && distance < 1e-5 && candidateDistance > distance + 1e-4) break;
      }
      result.push(nearest);
      cursor = nearest;
    }
  }
  return result;
}
