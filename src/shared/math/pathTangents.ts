type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function chordHeading(start: RecordValue, end: RecordValue): number | undefined {
  if (!finite(start.x) || !finite(start.y) || !finite(end.x) || !finite(end.y)) return undefined;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dy, dx) : undefined;
}

function handleHeading(origin: RecordValue, handle: unknown, fallback: number | undefined, reverse = false): number | undefined {
  if (!isRecord(handle) || !finite(origin.x) || !finite(origin.y) || !finite(handle.x) || !finite(handle.y)) return fallback;
  const dx = reverse ? origin.x - handle.x : handle.x - origin.x;
  const dy = reverse ? origin.y - handle.y : handle.y - origin.y;
  return Math.hypot(dx, dy) > 1e-9 ? Math.atan2(dy, dx) : fallback;
}

function arcEndHeading(start: RecordValue, end: RecordValue, fallback: number | undefined): number | undefined {
  if (fallback === undefined || !finite(start.x) || !finite(start.y) || !finite(end.x) || !finite(end.y)) return fallback;
  const startHeading = handleHeading(start, start.nextC, fallback);
  if (startHeading === undefined) return fallback;
  const tx = Math.cos(startHeading);
  const ty = Math.sin(startHeading);
  const nx = -ty;
  const ny = tx;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = 2 * (dx * nx + dy * ny);
  if (Math.abs(denominator) < 1e-3) return fallback;
  const radius = (dx * dx + dy * dy) / denominator;
  if (!Number.isFinite(radius) || Math.abs(radius) > 1e4) return fallback;
  const centerX = start.x + radius * nx;
  const centerY = start.y + radius * ny;
  const radialHeading = Math.atan2(end.y - centerY, end.x - centerX);
  return radialHeading + (radius > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** Exact incoming and outgoing geometry tangents at an interior waypoint. */
export function stoppedTangentHeadings(waypoints: readonly unknown[], index: number): { incoming: number; outgoing: number } | undefined {
  const previous = waypoints[index - 1];
  const waypoint = waypoints[index];
  const next = waypoints[index + 1];
  if (!isRecord(previous) || !isRecord(waypoint) || !isRecord(next)) return undefined;
  const incomingChord = chordHeading(previous, waypoint);
  const outgoingChord = chordHeading(waypoint, next);
  if (incomingChord === undefined || outgoingChord === undefined) return undefined;

  const incomingType = previous.segType ?? "bezier";
  const outgoingType = waypoint.segType ?? "bezier";
  if (incomingType === "clothoid" && outgoingType === "clothoid") {
    const incomingHandle = handleHeading(waypoint, waypoint.prevC, incomingChord, true) ?? incomingChord;
    const outgoingHandle = handleHeading(waypoint, waypoint.nextC, outgoingChord) ?? outgoingChord;
    const shared = incomingHandle + Math.atan2(
      Math.sin(outgoingHandle - incomingHandle),
      Math.cos(outgoingHandle - incomingHandle),
    ) / 2;
    return { incoming: shared, outgoing: shared };
  }

  const incoming = incomingType === "line"
    ? incomingChord
    : incomingType === "arc"
      ? arcEndHeading(previous, waypoint, incomingChord)
      : incomingType === "clothoid"
        ? handleHeading(waypoint, waypoint.prevC, incomingChord, true)
        : handleHeading(waypoint, waypoint.prevC, undefined, true)
          ?? handleHeading(waypoint, previous.nextC, incomingChord, true);
  const outgoing = outgoingType === "line"
    ? outgoingChord
    : outgoingType === "clothoid" || outgoingType === "arc"
      ? handleHeading(waypoint, waypoint.nextC, outgoingChord)
      : handleHeading(waypoint, waypoint.nextC, undefined)
        ?? handleHeading(waypoint, next.prevC, outgoingChord);
  return incoming === undefined || outgoing === undefined ? undefined : { incoming, outgoing };
}

/** Exact tangent at the start of an outgoing segment, when geometry is readable. */
export function outgoingSegmentTangentHeading(waypoints: readonly unknown[], index: number): number | undefined {
  if (index > 0 && index < waypoints.length - 1) return stoppedTangentHeadings(waypoints, index)?.outgoing;
  const waypoint = waypoints[index];
  const next = waypoints[index + 1];
  if (!isRecord(waypoint) || !isRecord(next)) return undefined;
  const chord = chordHeading(waypoint, next);
  if (chord === undefined) return undefined;
  if (waypoint.segType === "line") return chord;
  if (waypoint.segType === "arc" || waypoint.segType === "clothoid") {
    return handleHeading(waypoint, waypoint.nextC, chord);
  }
  return handleHeading(waypoint, waypoint.nextC, undefined)
    ?? handleHeading(waypoint, next.prevC, chord);
}
