// @ts-nocheck
// Generated from Bordeaux (standalone).html. Do not edit by hand.
  // ---- geometry helpers ----
  const lerp = (a, b, t) => a + (b - a) * t;
  function bez(p0, c0, c1, p1, t) {
    const u = 1 - t, tt = t * t, uu = u * u;
    const a = uu * u, b = 3 * uu * t, c = 3 * u * tt, d = tt * t;
    return { x: a * p0.x + b * c0.x + c * c1.x + d * p1.x, y: a * p0.y + b * c0.y + c * c1.y + d * p1.y };
  }
  function bezD(p0, c0, c1, p1, t) {
    const u = 1 - t;
    const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
    return { x: a * (c0.x - p0.x) + b * (c1.x - c0.x) + c * (p1.x - c1.x), y: a * (c0.y - p0.y) + b * (c1.y - c0.y) + c * (p1.y - c1.y) };
  }
  function bezDD(p0, c0, c1, p1, t) {
    const u = 1 - t;
    return { x: 6 * u * (c1.x - 2 * c0.x + p0.x) + 6 * t * (p1.x - 2 * c1.x + c0.x), y: 6 * u * (c1.y - 2 * c0.y + p0.y) + 6 * t * (p1.y - 2 * c1.y + c0.y) };
  }

  // shortest signed angle difference (radians)
  function angWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function angLerp(a, b, t) { return a + angWrap(b - a) * t; }
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ---- arc primitive: circle tangent to the start handle, through the endpoint ----
  function arcSetup(p0, p1, c0) {
    let tx = c0.x - p0.x, ty = c0.y - p0.y; let tl = Math.hypot(tx, ty);
    if (tl < 1e-6) { tx = p1.x - p0.x; ty = p1.y - p0.y; tl = Math.hypot(tx, ty); }
    if (tl < 1e-6) return null;
    tx /= tl; ty /= tl; const nx = -ty, ny = tx;
    const dx = p1.x - p0.x, dy = p1.y - p0.y; const denom = 2 * (dx * nx + dy * ny);
    if (Math.abs(denom) < 1e-3) return null; // effectively straight
    const R = (dx * dx + dy * dy) / denom;
    const Cx = p0.x + R * nx, Cy = p0.y + R * ny, rad = Math.abs(R);
    const a0 = Math.atan2(p0.y - Cy, p0.x - Cx), a1 = Math.atan2(p1.y - Cy, p1.x - Cx);
    let sweep = a1 - a0;
    if (R > 0) { while (sweep <= 1e-6) sweep += 2 * Math.PI; while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI; }
    else { while (sweep >= -1e-6) sweep -= 2 * Math.PI; while (sweep < -2 * Math.PI) sweep += 2 * Math.PI; }
    if (rad > 1e4) return null;
    return { Cx, Cy, rad, a0, sweep };
  }

  // ---- clothoid (Euler spiral): G1 Hermite fit, linearly-varying curvature ----
  // single-clothoid from pose (p0,th0) to (p1,th1); returns dense table or null
  function clothoidTable(p0, p1, th0, th1, M) {
    const dx = p1.x - p0.x, dy = p1.y - p0.y; const r = Math.hypot(dx, dy);
    if (r < 1e-6) return null;
    const tau = Math.atan2(dy, dx);
    const ph0 = angWrap(th0 - tau), ph1 = angWrap(th1 - tau);
    const dphi = ph1 - ph0;
    const Hsin = (b) => { let s = 0; const N = 24; for (let k = 0; k <= N; k++) { const t = k / N; const th = ph0 + (dphi - b) * t + b * t * t; const w = (k === 0 || k === N) ? 1 : (k % 2 ? 4 : 2); s += w * Math.sin(th); } return s / (3 * N); };
    const Hcos = (b) => { let s = 0; const N = 24; for (let k = 0; k <= N; k++) { const t = k / N; const th = ph0 + (dphi - b) * t + b * t * t; const w = (k === 0 || k === N) ? 1 : (k % 2 ? 4 : 2); s += w * Math.cos(th); } return s / (3 * N); };
    // root of Hsin(b)=0 with the smallest |b| (closest to a gentle spiral)
    let best = null; const lo = -6 * Math.PI, hi = 6 * Math.PI, STEPS = 240; let pb = lo, pf = Hsin(lo);
    for (let k = 1; k <= STEPS; k++) {
      const b = lo + (hi - lo) * k / STEPS, f = Hsin(b);
      if (pf * f < 0) { let a = pb, bb = b, fa = pf; for (let it = 0; it < 44; it++) { const m = (a + bb) / 2, fm = Hsin(m); if (fa * fm <= 0) bb = m; else { a = m; fa = fm; } } const root = (a + bb) / 2; if (best === null || Math.abs(root) < Math.abs(best)) best = root; }
      pb = b; pf = f;
    }
    if (best === null) return null;
    const b = best, denom = Hcos(b); if (denom <= 1e-3) return null; // path would double back
    const L = r / denom; if (!isFinite(L) || L <= 0 || L > r * 30) return null;
    const thAbs = (t) => tau + ph0 + (dphi - b) * t + b * t * t;
    const xs = new Array(M + 1), ys = new Array(M + 1), hs = new Array(M + 1), ks = new Array(M + 1);
    xs[0] = p0.x; ys[0] = p0.y; hs[0] = thAbs(0); ks[0] = (dphi - b) / L;
    let cx = 0, cy = 0; const dt = 1 / M;
    for (let m = 1; m <= M; m++) { const tm = (m - 0.5) / M; const a = thAbs(tm); cx += Math.cos(a) * L * dt; cy += Math.sin(a) * L * dt; const t = m / M; xs[m] = p0.x + cx; ys[m] = p0.y + cy; hs[m] = thAbs(t); ks[m] = ((dphi - b) + 2 * b * t) / L; }
    return { xs, ys, hs, ks };
  }

  // ---- sample the whole path into dense points with arclength + curvature ----
  // waypoints: [{x,y, prevC, nextC, segType?}]  segType: bezier | line | arc | clothoid
  function sample(waypoints, perSeg = 60) {
    const pts = [];
    const segs = waypoints.length - 1;
    if (segs < 1) return { pts: [], length: 0, segs: 0 };
    const steps = perSeg;

    const segTypeAt = (i) => (waypoints[i] && waypoints[i].segType) || 'bezier';
    const pointOf = (w) => ({ x: w.x, y: w.y });
    const chordHeading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    const outHeading = (i) => {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = pointOf(w0), p1 = pointOf(w1), c0 = w0.nextC || p1;
      return Math.hypot(c0.x - p0.x, c0.y - p0.y) > 1e-6 ? Math.atan2(c0.y - p0.y, c0.x - p0.x) : chordHeading(p0, p1);
    };
    const inHeading = (i) => {
      const w0 = waypoints[i - 1], w1 = waypoints[i];
      const p0 = pointOf(w0), p1 = pointOf(w1), c1 = w1.prevC || p0;
      return Math.hypot(p1.x - c1.x, p1.y - c1.y) > 1e-6 ? Math.atan2(p1.y - c1.y, p1.x - c1.x) : chordHeading(p0, p1);
    };
    const blendedJointHeading = (i) => {
      const prevIsClothoid = i > 0 && segTypeAt(i - 1) === 'clothoid';
      const nextIsClothoid = i < segs && segTypeAt(i) === 'clothoid';
      if (prevIsClothoid && nextIsClothoid) {
        const a = inHeading(i), b = outHeading(i);
        return a + 0.5 * angWrap(b - a);
      }
      if (prevIsClothoid) return inHeading(i);
      if (nextIsClothoid) return outHeading(i);
      return 0;
    };
    const jointHeading = waypoints.map((_, i) => blendedJointHeading(i));
    const clothoidSegments = new Set();

    for (let i = 0; i < segs; i++) {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = { x: w0.x, y: w0.y }, p1 = { x: w1.x, y: w1.y };
      const c0 = w0.nextC, c1 = w1.prevC;
      let type = w0.segType || 'bezier';
      let arc = null, cloth = null, effType = type;
      if (type === 'arc') { arc = arcSetup(p0, p1, c0); if (!arc) effType = 'line'; }
      else if (type === 'clothoid') {
        const th0 = (i > 0 && segTypeAt(i - 1) === 'clothoid') ? jointHeading[i] : outHeading(i);
        const th1 = (i + 1 < segs && segTypeAt(i + 1) === 'clothoid') ? jointHeading[i + 1] : inHeading(i + 1);
        cloth = clothoidTable(p0, p1, th0, th1, steps); if (!cloth) effType = 'bezier';
      }
      if (effType === 'clothoid') clothoidSegments.add(i);
      for (let k = 0; k <= steps; k++) {
        if (i > 0 && k === 0) continue; // avoid dup at seg joints
        const t = k / steps;
        let pos, head, curv;
        if (effType === 'line') {
          pos = { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
          head = Math.atan2(p1.y - p0.y, p1.x - p0.x); curv = 0;
        } else if (effType === 'arc') {
          const ang = arc.a0 + arc.sweep * t;
          pos = { x: arc.Cx + arc.rad * Math.cos(ang), y: arc.Cy + arc.rad * Math.sin(ang) };
          head = ang + (arc.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);
          curv = arc.rad > 1e-6 ? 1 / arc.rad : 0;
        } else if (effType === 'clothoid') {
          pos = { x: cloth.xs[k], y: cloth.ys[k] }; head = cloth.hs[k]; curv = Math.abs(cloth.ks[k]);
        } else {
          pos = bez(p0, c0, c1, p1, t);
          const d = bezD(p0, c0, c1, p1, t), dd = bezDD(p0, c0, c1, p1, t);
          const speed2 = d.x * d.x + d.y * d.y, cross = d.x * dd.y - d.y * dd.x;
          head = Math.atan2(d.y, d.x); curv = speed2 > 1e-9 ? Math.abs(cross) / Math.pow(speed2, 1.5) : 0;
        }
        pts.push({ x: pos.x, y: pos.y, seg: i, t, heading: head, curv, s: 0 });
      }
    }

    // Blend curvature across adjacent clothoid joints. Position/heading already use a shared
    // tangent; this removes artificial velocity dips from independent curvature estimates.
    for (let j = 1; j < segs; j++) {
      if (!clothoidSegments.has(j - 1) || !clothoidSegments.has(j)) continue;
      const center = pts.findIndex((p) => p.seg === j - 1 && p.t > 1 - 1e-9);
      if (center < 0) continue;
      const next = Math.min(pts.length - 1, center + 1);
      const jointK = 0.5 * ((pts[center].curv || 0) + (pts[next].curv || 0));
      const span = Math.max(2, Math.round(steps * 0.16));
      for (let off = -span; off <= span; off++) {
        const idx = center + off;
        if (idx < 0 || idx >= pts.length) continue;
        if (!clothoidSegments.has(pts[idx].seg)) continue;
        const u = 1 - Math.min(1, Math.abs(off) / span);
        const w = u * u * (3 - 2 * u);
        pts[idx].curv = lerp(pts[idx].curv || 0, jointK, w);
      }
    }

    // arclength
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      s += Math.hypot(dx, dy);
      pts[i].s = s;
    }
    return { pts, length: s, segs };
  }

  // ---- trapezoidal velocity profile with curvature (centripetal) limit ----
  // constraints: {maxVel, maxAccel, maxAngVel, maxAngAccel}, start/end vel
  function profile(pts, c, startV = 0, endV = 0, opts = {}) {
    const n = pts.length;
    if (n < 2) return { v: [], t: [], totalTime: 0, holds: [], rotLimited: [] };
    const vmax = opts.vmax != null ? Math.min(c.maxVel, opts.vmax) : c.maxVel;
    const stopSet = new Set(opts.stopIdx || []);
    const v = new Array(n).fill(vmax);
    // curvature cap: v <= sqrt(aLat / k)
    const aLat = Math.max(0.1, c.maxCentripetalAccel ?? c.maxAccel);
    for (let i = 0; i < n; i++) {
      const k = pts[i].curv;
      if (k > 1e-4) v[i] = Math.min(v[i], Math.sqrt(aLat / k));
    }
    v[0] = Math.min(v[0], startV);
    v[n - 1] = Math.min(v[n - 1], endV);
    // hard stops: velocity pinned to 0
    stopSet.forEach(idx => { if (idx >= 0 && idx < n) v[idx] = 0; });
    // per-point accel/decel limits, tightened by any constraint ranges (tightest wins)
    const ranges = opts.ranges || [];
    const totalS = pts[n - 1].s || 1;
    const accelG = Math.max(0.1, c.maxAccel);
    const decelG = (c.maxDecel != null && c.maxDecel > 0) ? c.maxDecel : accelG;
    const aFwd = new Array(n).fill(accelG), aBack = new Array(n).fill(decelG);
    const rangeAngV = new Array(n).fill(Infinity);
    // Index i describes the interval (i - 1, i). Evaluating overlap instead of
    // requiring both endpoints to be inside a policy preserves very short
    // transition windows that fall between geometry samples.
    const translationPriority = new Array(n).fill(false);
    const headingTransitions = opts.headingTransitions || [];
    if (ranges.length || headingTransitions.length) {
      for (let i = 0; i < n; i++) {
        const f = pts[i].s / totalS;
        let rv = Infinity, ra = Infinity, rd = Infinity, rw = Infinity;
        for (let r = 0; r < ranges.length; r++) {
          const R = ranges[r]; const lo = Math.min(R.f0, R.f1), hi = Math.max(R.f0, R.f1);
          if (f >= lo && f <= hi) {
            if (R.maxVel > 0) rv = Math.min(rv, R.maxVel);
            if (R.maxAccel > 0) ra = Math.min(ra, R.maxAccel);
        }
        changed = true;
      }
      for (let i = 0; i < n; i++) v[i] = caps[i];
      for (let i = 1; i < n; i++) {
        const ds = pts[i].s - pts[i - 1].s;
        v[i] = Math.min(v[i], Math.sqrt(Math.max(0, v[i - 1] * v[i - 1] + 2 * aFwd[i] * ds)));
      }
      for (let i = n - 2; i >= 0; i--) {
        const ds = pts[i + 1].s - pts[i].s;
        v[i] = Math.min(v[i], Math.sqrt(Math.max(0, v[i + 1] * v[i + 1] + 2 * aBack[i] * ds)));
      }
      if (!changed) break;
    }
  }
  // time
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const ds = pts[i].s - pts[i - 1].s;
    const vm = (v[i] + v[i - 1]) / 2;
    t[i] = t[i - 1] + (vm > 1e-4 ? ds / vm : 0);
  }
  // Stationary turns happen after arrival and before any wait.
  const turns: TimedTurn[] = [], turnDelay = new Map<number, number>(); let terminalDelay = 0;
  (opts.turns || []).slice().sort((a, b) => a.idx - b.idx).forEach((turn) => {
    if (turn.idx < 0 || turn.idx >= n) return;
    let delta = angWrap(turn.end - turn.start);
    if (turn.direction === 'clockwise' && delta > 0) delta -= Math.PI * 2;
    if (turn.direction === 'counterclockwise' && delta < 0) delta += Math.PI * 2;
    if (Math.abs(delta) < 1e-9) return;
    const wMax = Math.max(1e-6, (turn.maxAngVel || 540) * D2R), aMax = Math.max(1e-6, (turn.maxAngAccel || 720) * D2R), jMax = Math.max(0, (turn.maxAngJerk || 0) * D2R);
    const duration = Math.max(Math.abs(delta) * 1.875 / wMax, Math.sqrt(Math.abs(delta) * 5.77351 / aMax), jMax > 1e-9 ? Math.cbrt(Math.abs(delta) * 60 / jMax) : 0);
    const t0 = t[turn.idx]; turns.push({ idx: turn.idx, t0, t1: t0 + duration, start: turn.start, delta }); turnDelay.set(turn.idx, duration);
    for (let j = turn.idx + 1; j < n; j++) t[j] += duration;
    if (turn.idx === n - 1) terminalDelay += duration;
  });
  // dwell / wait-at-waypoint holds (memo §15) — only meaningful at stop points
  const holds: TimedHold[] = [];
  const dwell = (opts.dwell || []).slice().sort((a, b) => a.idx - b.idx);
  for (let d = 0; d < dwell.length; d++) {
    const dw = dwell[d]; if (!(dw.wait > 0) || dw.idx < 0 || dw.idx >= n) continue;
    const t0 = t[dw.idx] + (turnDelay.get(dw.idx) || 0); holds.push({ idx: dw.idx, t0, t1: t0 + dw.wait });
    for (let j = dw.idx + 1; j < n; j++) t[j] += dw.wait;
    if (dw.idx === n - 1) terminalDelay += dw.wait;
  }
  return { v, t, totalTime: t[n - 1] + terminalDelay, holds, turns, rotLimited };
}

// pose at time given sampled pts, profile times, and heading anchors / mode
function poseAtTime(time: number, pts: readonly Pick<GeometryPoint, "x" | "y" | "heading" | "s">[], prof: VelocityProfile, anchors: readonly HeadingAnchor[], mode: DriveType, rev = false) {
  const n = pts.length;
  if (n < 2) return null;
  const T = prof.t;
  // wait/dwell hold: robot is stationary at the stop point for the dwell window (memo §15)
  if (prof.holds && prof.holds.length) {
    for (let k = 0; k < prof.holds.length; k++) {
      const hd = prof.holds[k];
      if (time >= hd.t0 - 1e-9 && time <= hd.t1 + 1e-9) {
        const p = pts[hd.idx]; const f = pts[n - 1].s > 1e-6 ? p.s / pts[n - 1].s : 0;
        let heading = mode === 'tank' ? p.heading : headingAt(f, anchors); if (rev) heading += Math.PI;
        return { x: p.x, y: p.y, heading, speed: 0, s: p.s, f, hold: true };
      }
    }
  }
  if (prof.turns && prof.turns.length) {
    for (let k = 0; k < prof.turns.length; k++) {
      const turn = prof.turns[k];
      if (time >= turn.t0 - 1e-9 && time <= turn.t1 + 1e-9) {
        const p = pts[turn.idx], u = Math.max(0, Math.min(1, (time - turn.t0) / Math.max(1e-9, turn.t1 - turn.t0)));
        const q = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5, f = pts[n - 1].s > 1e-6 ? p.s / pts[n - 1].s : 0;
        let heading = turn.start + turn.delta * q; if (rev) heading += Math.PI;
        return { x: p.x, y: p.y, heading, speed: 0, s: p.s, f, turn: true };
      }
    }
  }
  let i = 1;
  if (time <= 0) i = 1; else if (time >= T[n - 1]) i = n - 1;
  else { // binary search
    let lo = 1, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < time) lo = mid + 1; else hi = mid; }
    i = lo;
  }
  const t0 = T[i - 1], t1 = T[i];
  const u = t1 - t0 > 1e-6 ? Math.max(0, Math.min(1, (time - t0) / (t1 - t0))) : 0;
  const a = pts[i - 1], b = pts[i];
  const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
  const s = lerp(a.s, b.s, u);
  const f = pts[n - 1].s > 1e-6 ? s / pts[n - 1].s : 0;
  let heading;
  if (mode === 'tank') heading = Math.atan2(b.y - a.y, b.x - a.x);
  else heading = headingAt(f, anchors);
  if (rev) heading += Math.PI;
  const speed = lerp(prof.v[i - 1], prof.v[i], u);
  return { x, y, heading, speed, s, f };
}

// ---- per-point engineering metrics aligned to the sampled path ----
// returns arrays + maxima for velocity / acceleration / angular velocity / curvature
function metrics(pts: readonly Pick<GeometryPoint, "s" | "heading" | "curv">[], prof: Pick<VelocityProfile, "v" | "t">, anchors: readonly HeadingAnchor[], mode: DriveType) {
  const n = pts.length;
  const v = prof.v && prof.v.length ? prof.v : new Array<number>(n).fill(0);
  const t = prof.t && prof.t.length ? prof.t : new Array<number>(n).fill(0);
  const accel = new Array<number>(n).fill(0), omega = new Array<number>(n).fill(0), curv = new Array<number>(n).fill(0), head = new Array<number>(n).fill(0);
  const totalS = n ? pts[n - 1].s : 0;
  for (let i = 0; i < n; i++) {
    const f = totalS > 1e-6 ? pts[i].s / totalS : 0;
    head[i] = mode === 'tank' ? pts[i].heading : headingAt(f, anchors);
    curv[i] = pts[i].curv || 0;
  }
  for (let i = 1; i < n; i++) {
    const dt = t[i] - t[i - 1];
    accel[i] = dt > 1e-5 ? (v[i] - v[i - 1]) / dt : 0;
    omega[i] = dt > 1e-5 ? angWrap(head[i] - head[i - 1]) / dt : 0;
  }
  if (n > 1) { accel[0] = accel[1]; omega[0] = omega[1]; }
  let vMax = 0.1, aMax = 0.1, wMax = 0.01, kMax = 0.01;
  for (let i = 0; i < n; i++) {
    vMax = Math.max(vMax, v[i]); aMax = Math.max(aMax, Math.abs(accel[i]));
    wMax = Math.max(wMax, Math.abs(omega[i])); kMax = Math.max(kMax, curv[i]);
  }
  return { v, accel, omega, curv, head, vMax, aMax, wMax, kMax };
}

// ---- safety analysis: flag tight curvature + sharp velocity dips ----
function analyze(pts: readonly Pick<GeometryPoint, "s" | "curv">[], _prof: VelocityProfile, m: ReturnType<typeof metrics>, robot: Partial<Pick<RobotConfig, "maxSpeed">> | null) {
  const n = pts.length; const out: PathWarning[] = [];
  if (n < 3) return out;
  const totalS = pts[n - 1].s || 1;
  const vCap = (robot && robot.maxSpeed) || 5;
  // tight curvature: radius below ~0.7 m is hard on a drivetrain
  let cuf = -1, cuMax = 0, cuAt = 0;
  for (let i = 1; i < n - 1; i++) {
    const rad = pts[i].curv > 1e-4 ? 1 / pts[i].curv : Infinity;
    if (rad < 0.7) { if (pts[i].curv > cuMax) { cuMax = pts[i].curv; cuAt = i; } if (cuf < 0) cuf = i; }
    else if (cuf >= 0) { out.push({ f: pts[cuAt].s / totalS, kind: 'curv', sev: cuMax > 2.5 ? 'high' : 'med', text: 'Tight curvature \u00b7 R\u2248' + (1 / cuMax).toFixed(2) + ' m' }); cuf = -1; cuMax = 0; }
  }
  if (cuf >= 0) out.push({ f: pts[cuAt].s / totalS, kind: 'curv', sev: cuMax > 2.5 ? 'high' : 'med', text: 'Tight curvature \u00b7 R\u2248' + (1 / cuMax).toFixed(2) + ' m' });
  // velocity dip: local minimum well below surrounding speed (slow-down the user may not intend)
  const v = m.v;
  for (let i = 6; i < n - 6; i++) {
    const local = v[i];
    const around = Math.max(v[i - 6], v[i + 6]);
    if (around > 1.2 && local < around * 0.45 && local < vCap * 0.5) {
      // ensure it's a genuine trough
      if (v[i] <= v[i - 1] && v[i] <= v[i + 1]) { out.push({ f: pts[i].s / totalS, kind: 'vel', sev: local < around * 0.3 ? 'high' : 'med', text: 'Velocity dip \u00b7 ' + local.toFixed(1) + ' m/s' }); i += 10; }
    }
  }
  return out;
}

// ---- one-call derivation: everything the field + panels need for a path ----
function derivePath(doc: PathDoc, robot: RobotConfig | null, perSeg?: number, options?: { skipStationaryActions?: boolean }) {
  perSeg = perSeg || 56;
  const smp = sample(doc.waypoints, perSeg, true);
  const nWp = doc.waypoints.length;
  const originalLast = Math.max(0, smp.pts.length - 1);
  let wpIdx = smp.wpIdx ?? doc.waypoints.map((_, k) => Math.min(originalLast, k * perSeg));
  const initialWpFrac = wpIdx.map((index) => smp.pts.length ? smp.pts[index].s / (smp.length || 1) : 0);
  const targetFractions = (doc.targets || []).map((target) => featureFraction(target, smp)).filter((fraction) => {
    let segment = 0;
    while (segment < nWp - 2 && fraction >= initialWpFrac[segment + 1] - 1e-9) segment++;
    const mode = robot && robot.drive === 'tank'
      ? 'tangent'
      : ((doc.waypoints[segment] && doc.waypoints[segment].segmentHeadingMode) || doc.headingMode || 'targets');
    return mode === 'targets';
  });
  wpIdx = insertHeadingTargetSamples(smp, targetFractions, wpIdx);
  const pts = smp.pts;
  const total = smp.length || 1;
  const wpFrac = wpIdx.map((i) => (pts.length ? pts[i].s / total : 0));
  const stopIdx: number[] = [];
  doc.waypoints.forEach((w, k) => { if (w.stop) stopIdx.push(wpIdx[k]); });
  const cap = (robot && robot.maxSpeed) || doc.constraints.maxVel;
  const vmax = Math.min(doc.constraints.maxVel, cap);
  const sv = doc.waypoints[0] && doc.waypoints[0].stop ? 0 : doc.startVel;
  const gv = doc.waypoints[nWp - 1] && doc.waypoints[nWp - 1].stop ? 0 : doc.goalVel;
  const effRanges = effectiveRanges(doc, smp);
  // Heading mode is owned by the outgoing segment; omitted overrides inherit the path default.
  const headingMode = (robot && robot.drive === 'tank') ? 'tangent' : (doc.headingMode || 'targets');
  const effectiveHeadingMode = (segment: number) => (robot && robot.drive === 'tank')
    ? 'tangent'
    : ((doc.waypoints[segment] && doc.waypoints[segment].segmentHeadingMode) || headingMode);
  const segmentModes = doc.waypoints.slice(0, -1).map((_, segment) => effectiveHeadingMode(segment));
  const manualEntries: HeadingAnchor[] = [], targetEntries: HeadingAnchor[] = [];
  doc.waypoints.forEach((w, k) => {
    const isEnd = k === 0 || k === nWp - 1;
    const incomingMode = segmentModes[k - 1];
    const outgoingMode = segmentModes[k];
    const entry = { f: wpFrac[k], rad: (w.theta || 0) * D2R };
    if (isEnd || (w.thetaOn && (incomingMode === 'manual' || (w.turnInPlace && outgoingMode === 'manual')))) manualEntries.push(entry);
    if (isEnd || (w.thetaOn && (incomingMode === 'targets' || (w.turnInPlace && outgoingMode === 'targets')))) targetEntries.push({ ...entry });
  });
  (doc.targets || []).forEach((t) => targetEntries.push({ f: featureFraction(t, smp), rad: t.deg * D2R }));
  const manualAnchors = buildAnchors(manualEntries), targetAnchors = buildAnchors(targetEntries);
  const rawHead: number[] = [];
  pts.forEach((p, pointIndex) => {
    const f = total > 1e-6 ? p.s / total : 0;
    let segment = 0;
    while (segment < nWp - 2 && pointIndex >= wpIdx[segment + 1]) segment++;
    const segmentMode = effectiveHeadingMode(segment);
    if (segmentMode === 'lookAt') {
      const target = doc.waypoints[segment] && doc.waypoints[segment].segmentLookAt;
      const dx = target ? target.x - p.x : 0, dy = target ? target.y - p.y : 0;
      rawHead.push(Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : (rawHead.length ? rawHead[rawHead.length - 1] : p.heading));
    } else {
      rawHead.push(segmentMode === 'tangent' ? p.heading : headingAt(f, segmentMode === 'targets' ? targetAnchors : manualAnchors));
    }
  });
  const segmentLaws = doc.waypoints.slice(0, -1).map((w, segment) => segmentModes[segment] === 'lookAt' ? 'lookAt:' + (w.segmentLookAt ? w.segmentLookAt.x : '') + ':' + (w.segmentLookAt ? w.segmentLookAt.y : '') : segmentModes[segment]);
  const transitionBreaks = doc.waypoints.slice(0, -1).map((w) => !!w.turnInPlace);
  const headingTransitions = headingTransitionWindows(doc.waypoints, segmentLaws, transitionBreaks, wpFrac, total, "heading");
  const transitionGoals = headingTransitionGoals(segmentLaws, transitionBreaks, wpIdx, pts, {
    manual: manualAnchors.map(({ f, rad }) => ({ f, heading: rad })),
    targets: targetAnchors.map(({ f, rad }) => ({ f, heading: rad })),
  });
  const head = smoothHeadingTransitions(rawHead, segmentLaws, transitionBreaks, wpIdx, pts, doc.waypoints, transitionGoals);
  const allTangent = doc.waypoints.slice(0, -1).every((_, segment) => effectiveHeadingMode(segment) === 'tangent');
  const mode: DriveType = allTangent ? 'tank' : 'swerve';
  const anchors = mode === 'tank' ? [] : buildAnchors(pts.map((p, i) => ({ f: total > 1e-6 ? p.s / total : 0, rad: head[i] })));
  const dwell: { idx: number; wait: number }[] = [], turns: ProfileTurn[] = [];
  doc.waypoints.forEach((w, k) => { if (w.stop && w.wait != null && w.wait > 0) dwell.push({ idx: wpIdx[k], wait: w.wait }); });
  if (!(options && options.skipStationaryActions)) doc.waypoints.forEach((w, k) => { if (w.stop && w.turnInPlace) turns.push({ idx: wpIdx[k], start: k > 0 ? head[Math.max(0, wpIdx[k] - 1)] : head[0], end: w.turnInPlace.headingDeg * D2R, direction: w.turnInPlace.direction, maxAngVel: doc.constraints.maxAngVel, maxAngAccel: Math.min(doc.constraints.maxAngAccel, doc.constraints.maxAngDecel || doc.constraints.maxAngAccel), maxAngJerk: doc.constraints.maxAngJerk }); });
  const prof = profile(pts, doc.constraints, sv, gv, { stopIdx, vmax, ranges: effRanges, headingTransitions, heading: head, dwell, turns });
  const mtr = metrics(pts, prof, anchors, mode);
  const warnings = analyze(pts, prof, mtr, robot || {});
  doc.waypoints.slice(0, -1).forEach((w, segment) => {
    if (w.segmentHeadingMode !== 'lookAt' || !w.segmentLookAt) return;
    let nearest = Infinity;
    for (let i = wpIdx[segment]; i <= wpIdx[segment + 1] && i < pts.length; i++) nearest = Math.min(nearest, Math.hypot(pts[i].x - w.segmentLookAt.x, pts[i].y - w.segmentLookAt.y));
    if (nearest < 0.05) warnings.push({ f: wpFrac[segment], kind: 'lookAt', sev: 'high', text: 'Tracked field point lies on the driven segment' });
  });
  // rotational diagnostics: flag contiguous rotation-limited stretches (memo §16)
  if (prof.rotLimited) {
    const rl = prof.rotLimited;
    const pushRun = (a: number, b: number) => {
      const mid = Math.floor((a + b) / 2);
      const accelerationLimited = rl.slice(a, b + 1).some((value) => value >= 2);
      warnings.push({
        f: pts[mid].s / total,
        kind: accelerationLimited ? 'angaccel' : 'rot',
        sev: 'med',
        text: accelerationLimited
          ? 'Angular acceleration-limited \u00b7 add more distance between heading anchors'
          : 'Angular velocity-limited \u00b7 heading can\u2019t keep up at speed',
      });
    };
    let run = -1;
    for (let i = 0; i < rl.length; i++) { if (rl[i]) { if (run < 0) run = i; } else if (run >= 0) { if (i - run > 3) pushRun(run, i - 1); run = -1; } }
    if (run >= 0 && rl.length - run > 3) pushRun(run, rl.length - 1);
  }
  // locate each warning to a segment + attach suggested fixes
  warnings.forEach((wn) => {
    let seg = 0;
    for (let i = 0; i < wpFrac.length - 1; i++) { if (wn.f >= wpFrac[i] - 1e-4) seg = i; }
    wn.seg = Math.max(0, Math.min(doc.waypoints.length - 2, seg));
    wn.fixes = wn.kind === 'curv'
      ? [{ id: 'clothoid', label: 'Convert segment to clothoid' }, { id: 'handles', label: 'Increase handle length' }, { id: 'cap', label: 'Cap velocity on this stretch' }, { id: 'insert', label: 'Insert a waypoint here' }]
      : wn.kind === 'angaccel'
      ? [{ id: 'angaccel', label: 'Raise max angular acceleration' }, { id: 'lead', label: 'Move rotation target earlier' }]
      : wn.kind === 'rot'
      ? [{ id: 'cap', label: 'Cap speed on this stretch' }, { id: 'angvel', label: 'Raise max angular velocity' }]
      : [{ id: 'cap', label: 'Lower the speed cap around here' }, { id: 'handles', label: 'Lengthen handles to ease the curve' }, { id: 'insert', label: 'Insert a waypoint here' }];
  });
  return { sample: smp, prof, anchors, metrics: mtr, warnings, wpFrac, wpIdx, mode, effRanges, headingMode, rev: !!doc.driveBackward };
}
function jigglePositions(anchor: ControlPoint, baseRad: number, options: { distanceM?: number; distance?: number; strokes: number; startDeg: number; stepDeg: number }, bounds = { w: 17.548, h: 8.052 }) {
  const distance = Number(options.distanceM ?? options.distance), strokes = Math.round(Number(options.strokes)), startDeg = Number(options.startDeg), stepDeg = Number(options.stepDeg);
  if (!(distance >= 0.03) || strokes < 2 || strokes > 12 || !Number.isFinite(startDeg + stepDeg)) return null;
  const directions = new Set<number>(), positions: ControlPoint[] = [];
  for (let stroke = 0; stroke < strokes; stroke++) {
    const relativeDeg = startDeg + stepDeg * stroke;
    const key = ((relativeDeg % 360) + 360) % 360;
    const roundedKey = Math.round(key * 1000) / 1000;
    if (directions.has(roundedKey)) return null;
    directions.add(roundedKey);
    const angle = baseRad + relativeDeg * D2R;
    const point = { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance };
    if (point.x < 0 || point.x > bounds.w || point.y < 0 || point.y > bounds.h) return null;
    positions.push(point, { x: anchor.x, y: anchor.y });
  }
  return positions;
}
export const PM = { bez, bezD, sample, profile, poseAtTime, headingAt, metrics, analyze, metricColor, metricGradient, METRICS, SEGTYPES, buildAnchors, pointAtFraction, nearestFraction, autoHandles, angWrap, angLerp, D2R, R2D, lerp, derivePath, jigglePositions, effectiveRanges, featureFraction, remapWaypointRange, waypointFracs };
export default PM;
