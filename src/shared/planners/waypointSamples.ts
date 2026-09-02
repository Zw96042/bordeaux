    while (runs[runPosition]?.end < cursor) runPosition += 1;
    const run = runs[runPosition];
    const start = run ? Math.max(cursor, run.start) : undefined;
    if (start !== undefined && start <= finalSearchIndex) {
      const end = Math.min(run.end, finalSearchIndex);
      for (let offset = 0; offset < groupSize; offset += 1) {
        const index = groupSize > 1
          ? Math.round(start + (end - start) * offset / (groupSize - 1))
          : start;
        indices.push(index);
      }
      nextRunPositions.set(key, runPosition + 1);
      cursor = indices.at(-1)!;
      waypointIndex = groupEnd + 1;
      continue;
    }

    for (; waypointIndex <= groupEnd; waypointIndex += 1) {
      const remaining = groupEnd - waypointIndex;
      const index = nearestIndex(
        waypoints[waypointIndex],
        samples,
        cursor,
        Math.max(cursor, finalSearchIndex - remaining),
        options.fallback === "stationary",
      );
      indices.push(index);
      cursor = index;
    }
  }
  return indices;
}
