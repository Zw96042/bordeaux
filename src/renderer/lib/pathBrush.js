      offset: parent.offset + parent.scale * segment.parent.offset,
    };
    return segment.resolved;
  };
  const restore = () => {
    const waypointIndexes = new Map(waypoints.map((waypoint, index) => [waypoint, index]));
    const segmentIndexes = new Map(segments.map((segment, index) => [segment, index]));
    for (const range of path.ranges || []) {
      if (range.anchor !== 'wp') continue;
      for (const [waypointKey, localKey] of [['w0', 't0'], ['w1', 't1']]) {
        if (!Number.isInteger(range[waypointKey])) continue;
        const authoredIndex = clamp(range[waypointKey], 0, originalWaypoints.length - 1);
        const waypointIndex = waypointIndexes.get(originalWaypoints[authoredIndex]);
        const legacy = range[localKey] == null;
        if (legacy && waypointIndex != null) {
          range[waypointKey] = waypointIndex;
          delete range[localKey];
          continue;
        }
        const segmentIndex = clamp(authoredIndex, 0, originalSegments.length - 1);
        const local = legacy ? (authoredIndex === originalWaypoints.length - 1 ? 1 : 0) : clamp(Number(range[localKey]), 0, 1);
        const resolved = resolve(originalSegments[segmentIndex]);
        range[waypointKey] = segmentIndexes.get(resolved.node);
        range[localKey] = clamp(resolved.offset + resolved.scale * local, 0, 1);
      }
      const start = range.w0 + (Number(range.t0) || 0);
      const end = range.w1 + (Number(range.t1) || 0);
      if (start > end) {
        [range.w0, range.w1] = [range.w1, range.w0];
        [range.t0, range.t1] = [range.t1, range.t0];
        if (range.t0 === undefined) delete range.t0;
        if (range.t1 === undefined) delete range.t1;
      }
    }
  };
  return { merge, restore };
}

function consolidateWaypoints(path, stroke) {
  const rangeRemapper = createRangeRemapper(path);
  let removed = 0;
  for (let index = 1; index < path.waypoints.length - 1 && removed < MAX_MERGES_PER_STROKE;) {
    const previous = path.waypoints[index - 1];
    const waypoint = path.waypoints[index];
    const next = path.waypoints[index + 1];
    const weight = falloff(distance(waypoint, stroke.center), stroke.radius);
    const spanReshapeable = isReshapeable(previous) && isReshapeable(waypoint);
    if (weight <= 0 || !spanReshapeable || isSemanticWaypoint(waypoint) || !sameSegmentMetadata(previous, waypoint)) {
      index += 1;
      continue;
    }
    const candidate = mergedCurveCandidate(previous, waypoint, next, stroke);
    const tolerance = stroke.radius * (0.008 + stroke.strength * 0.026) * weight;
    if (!candidate || candidate.error > tolerance || candidate.outsideError > OUTSIDE_TOLERANCE) {
      index += 1;
      continue;
    }
    previous.nextC = point(candidate.curve[1]);
    next.prevC = point(candidate.curve[2]);
    rangeRemapper.merge(index, candidate.splitFraction);
    path.waypoints.splice(index, 1);
    removed += 1;
    index = Math.max(1, index - 1);
  }
  if (removed > 0) rangeRemapper.restore();
  return removed;
}

const geometryOf = (path) => path.waypoints.map((waypoint) => [
  waypoint.x, waypoint.y,
  waypoint.prevC ? waypoint.prevC.x : null, waypoint.prevC ? waypoint.prevC.y : null,
  waypoint.nextC ? waypoint.nextC.x : null, waypoint.nextC ? waypoint.nextC.y : null,
].join(',')).join(';');

// Applies one stroke in place. Returns how much topology changed and whether the stroke
// moved anything at all, so a caller can skip the undo entry for a no-op.
function apply(path, input) {
  if (!path || !Array.isArray(path.waypoints) || path.waypoints.length < 2) {
    return { path, added: 0, removed: 0, changed: false };
  }
  const stroke = {
    kind: ['push', 'smooth', 'twirl'].includes(input.kind) ? input.kind : 'push',
    center: point(input.center),
    previous: point(input.previous || input.center),
    // Where the drag started. Twirl measures the angle swept about this point; without it
    // there is no centre to orbit, so fall back to the segment's own start.
    origin: point(input.origin || input.previous || input.center),
    radius: clamp(Number(input.radius) || 0.9, 0.2, 3),
    strength: clamp(Number(input.strength) || 0.65, 0.05, 1),
  };
  const before = geometryOf(path);
  const added = stroke.kind === 'smooth' ? 0 : densify(path, stroke.center, stroke.radius);
  const touched = stroke.kind === 'smooth' ? smoothWaypoints(path, stroke) : displaceWaypoints(path, stroke);
  refitHandles(path, touched);
  const removed = stroke.kind === 'smooth' ? consolidateWaypoints(path, stroke) : 0;
  return { path, added, removed, changed: added > 0 || removed > 0 || geometryOf(path) !== before };
}

export const PathBrush = { apply };
