// Topology-preserving path sculpting. Brush strokes refit the existing cubic
// controls; adding and removing authored waypoints belongs to explicit path tools.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const pointMix = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (value) => ({ x: value.x, y: value.y });

// Arc and clothoid geometry is generated from endpoint semantics rather than
// Bézier handles. Editing those handles would appear to succeed while doing nothing.
const RESHAPEABLE = new Set(['bezier', 'line', undefined, null, '']);
const isReshapeable = (waypoint) => !!waypoint && RESHAPEABLE.has(waypoint.segType);

function cubicPoints(start, end) {
  const p0 = point(start), p3 = point(end);
  if (start.segType === 'line') {
    return [p0, pointMix(p0, p3, 1 / 3), pointMix(p0, p3, 2 / 3), p3];
  }
  return [
    p0,
    point(start.nextC || pointMix(p0, p3, 1 / 3)),
    point(end.prevC || pointMix(p0, p3, 2 / 3)),
    p3,
  ];
}

function cubicPoint(curve, t) {
  const a = pointMix(curve[0], curve[1], t);
  const b = pointMix(curve[1], curve[2], t);
  const c = pointMix(curve[2], curve[3], t);
  return pointMix(pointMix(a, b, t), pointMix(b, c, t), t);
}

function falloff(value, radius) {
  const u = clamp(1 - value / Math.max(radius, 1e-6), 0, 1);
  return u * u * (3 - 2 * u);
}

function twirlAngle(stroke) {
  const anchor = stroke.origin;
  const ax = stroke.previous.x - anchor.x;
  const ay = stroke.previous.y - anchor.y;
  const bx = stroke.center.x - anchor.x;
  const by = stroke.center.y - anchor.y;
  const swept = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  if (Number.isFinite(swept) && Math.abs(swept) > 1e-9) return swept;

  // The first pointer sample has origin === previous. Give that sample a stable
  // direction instead of making diagonal drags cancel or silently do nothing.
  const dx = stroke.center.x - stroke.previous.x;
  const dy = stroke.center.y - stroke.previous.y;
  const travel = Math.hypot(dx, dy);
  if (travel <= 1e-9) return 0;
  const direction = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx || 1) : -Math.sign(dy || 1);
  return direction * travel / Math.max(stroke.radius, 1e-6);
}

function transformedTarget(value, curve, t, stroke) {
  const weight = falloff(distance(value, stroke.center), stroke.radius);
  if (weight <= 0) return point(value);
  if (stroke.kind === 'smooth') {
    const travel = distance(stroke.center, stroke.previous);
    const amount = clamp(travel / Math.max(stroke.radius, 1e-6) * 3.2, 0.025, 0.22)
      * stroke.strength * weight;
    return pointMix(value, pointMix(curve[0], curve[3], t), amount);
  }
  if (stroke.kind === 'twirl') {
    const angle = twirlAngle(stroke) * stroke.strength * 1.8 * weight;
    const x = value.x - stroke.center.x;
    const y = value.y - stroke.center.y;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return {
      x: stroke.center.x + x * cosine - y * sine,
      y: stroke.center.y + x * sine + y * cosine,
    };
  }
  const dx = stroke.center.x - stroke.previous.x;
  const dy = stroke.center.y - stroke.previous.y;
  return { x: value.x + dx * stroke.strength * weight, y: value.y + dy * stroke.strength * weight };
}

// Least-squares fit for P1/P2 with the authored P0/P3 anchors fixed. Unchanged
// outside-brush samples and a small prior on the old handles keep the best possible
// locality without manufacturing hidden path knots.
const FIT_SAMPLES = 32;
const HANDLE_REGULARIZATION = 0.04;

function fitDeformedSegment(curve, stroke) {
  if (stroke.kind === 'push' && distance(stroke.center, stroke.previous) <= 1e-9) return null;
  let a11 = HANDLE_REGULARIZATION;
  let a12 = 0;
  let a22 = HANDLE_REGULARIZATION;
  let bx1 = HANDLE_REGULARIZATION * curve[1].x;
  let bx2 = HANDLE_REGULARIZATION * curve[2].x;
  let by1 = HANDLE_REGULARIZATION * curve[1].y;
  let by2 = HANDLE_REGULARIZATION * curve[2].y;
  let influenced = false;

  for (let index = 1; index < FIT_SAMPLES; index++) {
    const t = index / FIT_SAMPLES;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    const current = cubicPoint(curve, t);
    if (falloff(distance(current, stroke.center), stroke.radius) > 0) influenced = true;
    const target = transformedTarget(current, curve, t, stroke);
    const residualX = target.x - b0 * curve[0].x - b3 * curve[3].x;
    const residualY = target.y - b0 * curve[0].y - b3 * curve[3].y;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    bx1 += b1 * residualX;
    bx2 += b2 * residualX;
    by1 += b1 * residualY;
    by2 += b2 * residualY;
  }
  if (!influenced) return null;
  const determinant = a11 * a22 - a12 * a12;
  if (Math.abs(determinant) < 1e-12) return null;
  return [
    curve[0],
    { x: (bx1 * a22 - bx2 * a12) / determinant, y: (by1 * a22 - by2 * a12) / determinant },
    { x: (bx2 * a11 - bx1 * a12) / determinant, y: (by2 * a11 - by1 * a12) / determinant },
    curve[3],
  ];
}

function alignLinkedWaypoint(waypoint) {
  const incomingLength = distance(waypoint, waypoint.prevC || waypoint);
  const outgoingLength = distance(waypoint, waypoint.nextC || waypoint);
  if (incomingLength < 1e-8 && outgoingLength < 1e-8) return;
  const incoming = incomingLength > 1e-8
    ? { x: (waypoint.x - waypoint.prevC.x) / incomingLength, y: (waypoint.y - waypoint.prevC.y) / incomingLength }
    : null;
  const outgoing = outgoingLength > 1e-8
    ? { x: (waypoint.nextC.x - waypoint.x) / outgoingLength, y: (waypoint.nextC.y - waypoint.y) / outgoingLength }
    : null;
  let x = (incoming ? incoming.x : 0) + (outgoing ? outgoing.x : 0);
  let y = (incoming ? incoming.y : 0) + (outgoing ? outgoing.y : 0);
  let magnitude = Math.hypot(x, y);
  if (magnitude < 1e-8) {
    x = outgoing ? outgoing.x : incoming.x;
    y = outgoing ? outgoing.y : incoming.y;
    magnitude = Math.hypot(x, y);
  }
  if (magnitude < 1e-8) return;
  x /= magnitude;
  y /= magnitude;
  waypoint.prevC = { x: waypoint.x - x * incomingLength, y: waypoint.y - y * incomingLength };
  waypoint.nextC = { x: waypoint.x + x * outgoingLength, y: waypoint.y + y * outgoingLength };
}

function geometryOf(path) {
  return path.waypoints.map((waypoint) => [
    waypoint.x, waypoint.y,
    waypoint.prevC ? waypoint.prevC.x : null, waypoint.prevC ? waypoint.prevC.y : null,
    waypoint.nextC ? waypoint.nextC.x : null, waypoint.nextC ? waypoint.nextC.y : null,
    waypoint.segType,
  ].join(',')).join(';');
}

function reshapeSegments(path, stroke) {
  const touched = new Set();
  for (let index = 0; index < path.waypoints.length - 1; index++) {
    const start = path.waypoints[index];
    const end = path.waypoints[index + 1];
    if (!isReshapeable(start)) continue;
    const curve = cubicPoints(start, end);
    const fitted = fitDeformedSegment(curve, stroke);
    if (!fitted) continue;
    const changed = distance(curve[1], fitted[1]) > 1e-9 || distance(curve[2], fitted[2]) > 1e-9;
    if (!changed) continue;
    start.nextC = point(fitted[1]);
    end.prevC = point(fitted[2]);
    if (start.segType === 'line') start.segType = 'bezier';
    touched.add(index);
  }

  for (let index = 1; index < path.waypoints.length - 1; index++) {
    const waypoint = path.waypoints[index];
    if (!waypoint.linked || waypoint.stop || waypoint.corner) continue;
    if (!touched.has(index - 1) && !touched.has(index)) continue;
    if (!isReshapeable(path.waypoints[index - 1]) || !isReshapeable(waypoint)) continue;
    alignLinkedWaypoint(waypoint);
  }
}

function apply(path, input) {
  if (!path || !Array.isArray(path.waypoints) || path.waypoints.length < 2) {
    return { path, added: 0, removed: 0, changed: false };
  }
  const stroke = {
    kind: ['push', 'smooth', 'twirl'].includes(input.kind) ? input.kind : 'push',
    center: point(input.center),
    previous: point(input.previous || input.center),
    origin: point(input.origin || input.previous || input.center),
    radius: clamp(Number(input.radius) || 0.9, 0.2, 3),
    strength: clamp(Number(input.strength) || 0.65, 0.05, 1),
  };
  const before = geometryOf(path);
  reshapeSegments(path, stroke);
  return { path, added: 0, removed: 0, changed: geometryOf(path) !== before };
}

export const PathBrush = { apply };
