import type { TrajectorySample, Waypoint } from "../types";

function coordinateKey(point: Pick<Waypoint, "x" | "y">): string {
  // Planner samples serialize geometry to four decimal places. Indexing the
  // authored coordinate at that same precision preserves the exact boundary.
  return `${Number(point.x.toFixed(4))},${Number(point.y.toFixed(4))}`;
}

function firstAtOrAfter(indices: readonly number[], minimum: number): number {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (indices[middle] < minimum) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Locates the ordered boundary sample retained for every authored waypoint.
 * Bordeaux planners preserve each waypoint at four-decimal sample precision;
 * indexing those coordinates avoids rescanning the trajectory per waypoint.
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
  const samplesByCoordinate = new Map<string, number[]>();
  samples.forEach((sample, index) => {
    const key = coordinateKey(sample);
    const indices = samplesByCoordinate.get(key);
    if (indices) indices.push(index);
    else samplesByCoordinate.set(key, [index]);
  });

  let cursor = 0;
  return waypoints.map((waypoint, waypointIndex) => {
    if (options.finalWaypointAtEnd && waypointIndex === waypoints.length - 1) return samples.length - 1;
    const indices = samplesByCoordinate.get(coordinateKey(waypoint));
    const position = indices ? firstAtOrAfter(indices, cursor) : 0;
    const index = indices?.[position];
    if (index === undefined) {
      let nearest = cursor;
      let distance = Infinity;
      const finalSearchIndex = options.fallback === "full"
        || options.fallback === "stationary"
        || waypointIndex === waypoints.length - 1
        ? samples.length - 1
        : Math.max(cursor, samples.length - (waypoints.length - waypointIndex));
      for (let candidate = cursor; candidate <= finalSearchIndex; candidate += 1) {
        const candidateDistance = Math.hypot(samples[candidate].x - waypoint.x, samples[candidate].y - waypoint.y);
        if (candidateDistance < distance) { nearest = candidate; distance = candidateDistance; }
        if (options.fallback === "stationary" && distance < 1e-5 && candidateDistance > distance + 1e-4) break;
      }
      cursor = nearest;
      return nearest;
    }
    cursor = index;
    return index;
  });
}
