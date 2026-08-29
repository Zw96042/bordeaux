  const dx = stroke.center.x - stroke.previous.x;
  const dy = stroke.center.y - stroke.previous.y;
  if (stroke.kind === 'twirl') {
    const angle = twirlAngle(stroke) * stroke.strength * 1.8 * weight;
    const x = value.x - stroke.center.x;
    const y = value.y - stroke.center.y;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return { x: stroke.center.x + x * cosine - y * sine, y: stroke.center.y + x * sine + y * cosine };
  }
  return { x: value.x + dx * stroke.strength * weight, y: value.y + dy * stroke.strength * weight };
}

// A waypoint bounding an arc or clothoid cannot move: those segments are generated from
// their endpoints, so shifting one silently reshapes the entire span, most of which lies
// outside the brush.
function boundsGeneratedSegment(path, index) {
  return !isReshapeable(path.waypoints[index])
    || (index > 0 && !isReshapeable(path.waypoints[index - 1]));
}

// Displaces every waypoint the stroke reaches, along with its handles, and reports each
// one's falloff weight so the refit can scale with how hard the stroke actually hit it.
function displaceWaypoints(path, stroke) {
  const touched = new Map();
  path.waypoints.forEach((waypoint, index) => {
    const weight = falloff(distance(waypoint, stroke.center), stroke.radius);
    if (weight <= 0 || boundsGeneratedSegment(path, index)) return;
    touched.set(index, weight);
    const transformed = transformPoint(waypoint, stroke);
    const previousControl = transformPoint(waypoint.prevC || waypoint, stroke);
    const nextControl = transformPoint(waypoint.nextC || waypoint, stroke);
    waypoint.x = clamp(transformed.x, 0, 17.548);
    waypoint.y = clamp(transformed.y, 0, 8.052);
    waypoint.prevC = previousControl;
    waypoint.nextC = nextControl;
  });
  return touched;
}

// Blends each touched waypoint's tangent toward the one implied by its neighbours,
// scaled by that waypoint's falloff weight. Blending rather than replacing matters: a
// waypoint grazed at the rim of the brush keeps essentially the handles it was authored
// with, so a small drag cannot swing far-away geometry. Handles stay collinear, which
// the project schema requires of interior moving waypoints.
function refitHandles(path, touched) {
  const waypoints = path.waypoints;
  for (const [index, weight] of touched) {
    const waypoint = waypoints[index];
    if (!waypoint || waypoint.stop || waypoint.corner || boundsGeneratedSegment(path, index)) continue;
    const previous = waypoints[Math.max(0, index - 1)];
    const next = waypoints[Math.min(waypoints.length - 1, index + 1)];
    let tx = next.x - previous.x;
    let ty = next.y - previous.y;
    const magnitude = Math.hypot(tx, ty);
    if (magnitude < 1e-8) continue;
    tx /= magnitude;
    ty /= magnitude;

    // Existing tangent, so a partially-weighted refit can rotate toward the fitted one
    // instead of snapping to it.
    const priorPrev = waypoint.prevC || waypoint;
    const priorNext = waypoint.nextC || waypoint;
    let ax = priorNext.x - priorPrev.x;
    let ay = priorNext.y - priorPrev.y;
    const priorMagnitude = Math.hypot(ax, ay);
    if (priorMagnitude > 1e-8) {
      ax /= priorMagnitude;
      ay /= priorMagnitude;
      // Keep the blend on the near side so a reversed handle pair cannot flip the tangent.
      if (ax * tx + ay * ty < 0) { ax = -ax; ay = -ay; }
      let bx = mix(ax, tx, weight);
      let by = mix(ay, ty, weight);
      const blended = Math.hypot(bx, by);
      if (blended > 1e-8) { tx = bx / blended; ty = by / blended; }
    }

    const priorIncoming = distance(waypoint, priorPrev);
    const priorOutgoing = distance(waypoint, priorNext);
    const incoming = index > 0 ? mix(priorIncoming, distance(waypoint, previous) * 0.34, weight) : 0;
    const outgoing = index + 1 < waypoints.length ? mix(priorOutgoing, distance(waypoint, next) * 0.34, weight) : 0;
    waypoint.prevC = { x: waypoint.x - tx * incoming, y: waypoint.y - ty * incoming };
    waypoint.nextC = { x: waypoint.x + tx * outgoing, y: waypoint.y + ty * outgoing };
    waypoint.linked = true;
    waypoint.corner = false;
  }
}

// Relaxes interior waypoints toward the midpoint of their neighbours and reports each
// one's falloff weight so the refit can scale with it.
function smoothWaypoints(path, stroke) {
  const original = path.waypoints.map(point);
  const travel = distance(stroke.center, stroke.previous);
  const scale = clamp(travel / Math.max(stroke.radius, 1e-6) * 3.2, 0.025, 0.22) * stroke.strength;
  const touched = new Map();
  for (let index = 1; index < path.waypoints.length - 1; index++) {
    const waypoint = path.waypoints[index];
    const weight = falloff(distance(waypoint, stroke.center), stroke.radius);
    if (weight <= 0 || waypoint.stop || waypoint.corner || boundsGeneratedSegment(path, index)) continue;
    const average = pointMix(original[index - 1], original[index + 1], 0.5);
    waypoint.x = mix(waypoint.x, average.x, scale * weight);
    waypoint.y = mix(waypoint.y, average.y, scale * weight);
    touched.set(index, weight);
  }
  return touched;
}

const SEGMENT_KEYS = ['segType', 'segmentHeadingMode', 'segmentFollowMode', 'segmentLookAt'];

function sameSegmentMetadata(first, second) {
  return SEGMENT_KEYS.every((key) => JSON.stringify(first[key]) === JSON.stringify(second[key]));
}

function isSemanticWaypoint(waypoint) {
  return waypoint.stop || waypoint.corner || waypoint.thetaOn || waypoint.wait != null
    || waypoint.turnInPlace != null || waypoint.jiggle != null || waypoint.headingTransition != null;
}

function distanceToSegment(value, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-18) return distance(value, start);
  const t = clamp(((value.x - start.x) * dx + (value.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(value, { x: start.x + dx * t, y: start.y + dy * t });
}

// Shortest distance from a point to a curve, approximated by its chord polyline. Unlike
// comparing points at equal t, this ignores the reparameterization a merge necessarily
// introduces and only reports genuine changes in shape.
function distanceToCurve(value, curve, steps = 64) {
  let closest = Infinity;
  let previous = curve[0];
  for (let index = 1; index <= steps; index++) {
    const current = cubicPoint(curve, index / steps);
    closest = Math.min(closest, distanceToSegment(value, previous, current));
    previous = current;
  }
  return closest;
}

// Fits one cubic through the span previous..waypoint..next and reports how far it
// strays from the original. `error` covers the whole span; `outsideError` covers only
// the portion beyond the stroke, which must stay put even when the merge is accepted.
function mergedCurveCandidate(previous, waypoint, next, stroke) {
  const left = cubicPoints(previous, waypoint);
  const right = cubicPoints(waypoint, next);
  const incoming = distance(left[2], left[3]);
  const outgoing = distance(right[0], right[1]);
  const handleTotal = incoming + outgoing;
  const lengthTotal = approximateLength(left, 16) + approximateLength(right, 16);
  const splitT = clamp(handleTotal > 1e-8 ? incoming / handleTotal : approximateLength(left, 16) / Math.max(lengthTotal, 1e-8), 0.08, 0.92);
  const curve = [
    left[0],
    { x: left[0].x + (left[1].x - left[0].x) / splitT, y: left[0].y + (left[1].y - left[0].y) / splitT },
    { x: right[3].x + (right[2].x - right[3].x) / (1 - splitT), y: right[3].y + (right[2].y - right[3].y) / (1 - splitT) },
    right[3],
  ];
  if (distance(curve[0], curve[1]) > lengthTotal * 1.5 || distance(curve[2], curve[3]) > lengthTotal * 1.5) return null;
  let error = 0;
  let outsideError = 0;
  for (let index = 0; index <= 24; index++) {
    const t = index / 24;
    const original = t <= splitT
      ? cubicPoint(left, t / splitT)
      : cubicPoint(right, (t - splitT) / (1 - splitT));
    error = Math.max(error, distance(original, cubicPoint(curve, t)));
    if (falloff(distance(original, stroke.center), stroke.radius) <= 0) {
      outsideError = Math.max(outsideError, distanceToCurve(original, curve));
    }
  }
  const halves = splitCubic(curve, splitT);
  const leftLength = approximateLength(halves.left);
  const rightLength = approximateLength(halves.right);
  return { curve, error, outsideError, splitFraction: leftLength / Math.max(leftLength + rightLength, 1e-9) };
}

// Merges redundant waypoints back into a single curve. A merge rewrites the handles of
// both neighbours, which can reach past the stroke, so the merged curve must also leave
// the part of the span outside the radius where it was.
const OUTSIDE_TOLERANCE = 1e-6;
const MAX_MERGES_PER_STROKE = 16;

// Range endpoints are attached to the original segment objects. Each accepted merge adds
// one affine parent link, so all links can be composed once after consolidation instead
// of rescanning every range after every removed waypoint.
function createRangeRemapper(path) {
  const waypoints = path.waypoints;
  const originalWaypoints = waypoints.slice();
  const originalSegments = waypoints.slice(0, -1).map(() => ({ parent: null, resolved: null }));
  const segments = originalSegments.slice();
  const merge = (waypointIndex, splitFraction) => {
    const left = segments[waypointIndex - 1], right = segments[waypointIndex];
    const merged = { parent: null, resolved: null };
    left.parent = { node: merged, scale: splitFraction, offset: 0 };
    right.parent = { node: merged, scale: 1 - splitFraction, offset: splitFraction };
    segments.splice(waypointIndex - 1, 2, merged);
  };
  const resolve = (segment) => {
    if (!segment.parent) return { node: segment, scale: 1, offset: 0 };
    if (segment.resolved) return segment.resolved;
    const parent = resolve(segment.parent.node);
    segment.resolved = {
      node: parent.node,
      scale: parent.scale * segment.parent.scale,
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
