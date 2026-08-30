// Bordeaux path math engine. Kept renderer-local until the shared planner reaches API parity.
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
  function splitBezier(p0, c0, c1, p1, t) {
    t = Math.max(0, Math.min(1, t));
    const mix = (a, b) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    const q0 = mix(p0, c0), q1 = mix(c0, c1), q2 = mix(c1, p1);
    const r0 = mix(q0, q1), r1 = mix(q1, q2), point = mix(r0, r1);
    return { point, left: [p0, q0, r0, point], right: [point, r1, q2, p1] };
  }
  function nearestPointOnSegment(point, pts, segment) {
    let best = null, bestDistance = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (b.seg !== segment || (a.seg !== segment && a.seg !== segment - 1)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const u = length2 > 1e-12 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
      const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance >= bestDistance) continue;
      const aT = a.seg === segment && Number.isFinite(a.t) ? a.t : 0;
      const bT = Number.isFinite(b.t) ? b.t : 1;
      bestDistance = distance;
      best = { x, y, t: lerp(aT, bT, u), heading: angLerp(a.heading || 0, b.heading || 0, u), seg: segment };
    }
    if (best) return best;
    pts.forEach((sample) => {
      if (sample.seg !== segment) return;
      const distance = (point.x - sample.x) ** 2 + (point.y - sample.y) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = { ...sample }; }
    });
    return best;
  }
  function bezDD(p0, c0, c1, p1, t) {
    const u = 1 - t;
    return { x: 6 * u * (c1.x - 2 * c0.x + p0.x) + 6 * t * (p1.x - 2 * c1.x + c0.x), y: 6 * u * (c1.y - 2 * c0.y + p0.y) + 6 * t * (p1.y - 2 * c1.y + c0.y) };
  }

  // shortest signed angle difference (radians)
  function angWrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function angLerp(a, b, t) { return a + angWrap(b - a) * t; }
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  function robotHardLimits(robot) {
    const m = robot && robot.driveModel;
    if (!m) return null;
    const values = [m.motorFreeRpm, m.motorMaxTorqueNm, m.motorCount, m.gearRatio, m.wheelDiameterM, m.massKg, m.moiKgM2, m.wheelbaseM, m.trackwidthM, m.wheelFrictionCoefficient];
    if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
    const radius = m.wheelDiameterM / 2;
    const maxSpeed = m.motorFreeRpm / 60 * Math.PI * m.wheelDiameterM / m.gearRatio;
    const motorAccel = m.motorCount * m.motorMaxTorqueNm * m.gearRatio / (radius * m.massKg);
    const tractionAccel = m.wheelFrictionCoefficient * 9.80665;
    const maxAccel = Math.min(motorAccel, tractionAccel);
    const moduleRadius = robot.drive === 'tank' ? m.trackwidthM / 2 : Math.hypot(m.wheelbaseM / 2, m.trackwidthM / 2);
    return {
      maxSpeed,
      maxAccel,
      maxCornerAccel: tractionAccel,
      maxAngVel: maxSpeed / moduleRadius * R2D,
      maxAngAccel: maxAccel * m.massKg * moduleRadius / m.moiKgM2 * R2D,
      motorAccel,
      tractionAccel,
    };
  }
  function effectiveConstraints(constraints, robot) {
    const limits = robotHardLimits(robot);
    return limits ? { ...constraints, maxVel: limits.maxSpeed, maxAccel: limits.maxAccel, maxDecel: limits.maxAccel, maxCentripetalAccel: limits.maxCornerAccel, maxAngVel: limits.maxAngVel, maxAngAccel: limits.maxAngAccel, maxAngDecel: limits.maxAngAccel } : constraints;
  }

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
    if (segs < 1) return { pts: [], length: 0, segs: 0, wpIdx: [] };
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
    const wpIdx = [0];

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
      wpIdx.push(pts.length - 1);
    }

    // Blend curvature across adjacent clothoid joints. Position/heading already use a shared
    // tangent; this removes artificial velocity dips from independent curvature estimates.
    for (let j = 1; j < segs; j++) {
      if (!clothoidSegments.has(j - 1) || !clothoidSegments.has(j)) continue;
      const center = wpIdx[j];
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
    return { pts, length: s, segs, wpIdx };
  }

  // ---- trapezoidal velocity profile with curvature (centripetal) limit ----
  // constraints: {maxVel, maxAccel, maxAngVel, maxAngAccel}, start/end vel
  function jigglePhase(progress) {
    const u = Math.max(0, Math.min(1, progress));
    if (u < 0.25) return { position: 8 * u * u, velocity: 16 * u, travel: 8 * u * u };
    if (u < 0.5) { const r = 0.5 - u, position = 1 - 8 * r * r; return { position, velocity: 16 * r, travel: position }; }
    if (u < 0.75) { const e = u - 0.5, position = 1 - 8 * e * e; return { position, velocity: -16 * e, travel: 2 - position }; }
    const r = 1 - u, position = 8 * r * r; return { position, velocity: -16 * r, travel: 2 - position };
  }

  function feasibleJiggleStrokeDuration(requested, distance, velocity, acceleration, deceleration, freeSpeed) {
    const minimum = Math.max(requested, 4 * distance / Math.max(1e-9, Math.min(velocity, freeSpeed)), Math.sqrt(16 * distance / Math.max(1e-9, deceleration)));
    const feasible = (duration) => {
      const peakVelocity = 4 * distance / duration;
      const availableAcceleration = acceleration * Math.max(0, 1 - peakVelocity / freeSpeed);
      return 16 * distance / (duration * duration) <= availableAcceleration + 1e-9;
    };
    if (feasible(minimum)) return minimum;
    let low = minimum, high = minimum;
    while (!feasible(high)) high *= 2;
    for (let iteration = 0; iteration < 40; iteration++) {
      const middle = (low + high) / 2;
      if (feasible(middle)) high = middle; else low = middle;
    }
    return high;
  }

  function profile(pts, c, startV = 0, endV = 0, opts = {}) {
    const n = pts.length;
    if (n < 2) return { v: [], t: [], totalTime: 0, holds: [], turns: [], jiggles: [], actionDistance: 0, rotLimited: [] };
    const vmax = opts.vmax != null ? Math.min(c.maxVel, opts.vmax) : c.maxVel;
    const stopSet = new Set(opts.stopIdx || []);
    const v = new Array(n).fill(vmax);
    const vLimit = new Array(n).fill(vmax);
    // curvature cap: v <= sqrt(aLat / k)
    const aLat = Math.max(0.1, c.maxCentripetalAccel != null ? c.maxCentripetalAccel : c.maxAccel);
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
            if (R.maxDecel > 0) rd = Math.min(rd, R.maxDecel);
            if (R.maxAngVel > 0) rw = Math.min(rw, R.maxAngVel);
          }
        }
        if (rv < Infinity) { v[i] = Math.min(v[i], rv); vLimit[i] = Math.min(vLimit[i], rv); }
        if (ra < Infinity) aFwd[i] = Math.min(accelG, ra);
        if (rd < Infinity) aBack[i] = Math.min(decelG, rd);
        if (rw < Infinity) rangeAngV[i] = rw * Math.PI / 180;
      }
      let translationFollowing = false;
      for (let i = 1; i < n; i++) {
        const start = pts[i - 1].s / totalS, end = pts[i].s / totalS;
        const overlaps = (lo, hi) => Math.min(end, hi) - Math.max(start, lo) >= -1e-9;
        const activeRanges = ranges.filter((R) => overlaps(Math.min(R.f0, R.f1), Math.max(R.f0, R.f1)));
        const activeTransitions = headingTransitions.filter((policy) => overlaps(policy.start, policy.end));
        const activePolicies = activeRanges.length + activeTransitions.length;
        if (activePolicies > 0) {
          translationFollowing = activeRanges.every((R) => R.rotationPriority === 'translation')
            && activeTransitions.every((policy) => policy.rotationPriority === 'translation');
        }
        translationPriority[i] = translationFollowing;
      }
    }
    // ---- rotational limit: cap v so the commanded heading can actually be tracked ----
    // omega = (dtheta/ds) * v ; enforce |omega| <= Wmax and |d omega/dt| <= Aang (memo §16)
    const rotLimited = new Array(n).fill(0);
    const head = opts.heading;
    const Wmax = (c.maxAngVel || 0) * Math.PI / 180;
    const Aang = (c.maxAngAccel || 0) * Math.PI / 180;
    if (head && head.length === n && Wmax > 1e-4) {
      const g = new Array(n).fill(0), dth = new Array(n).fill(0);
      for (let i = 1; i < n; i++) { const ds = pts[i].s - pts[i - 1].s; const dd = angWrap(head[i] - head[i - 1]); dth[i] = Math.abs(dd); g[i] = ds > 1e-6 ? dd / ds : 0; }
      g[0] = g[1] || 0;
      const w = new Array(n);
      for (let i = 0; i < n; i++) w[i] = Math.min(Wmax, rangeAngV[i]);
      stopSet.forEach(idx => { if (idx >= 0 && idx < n) w[idx] = 0; });
      if (Aang > 1e-4) {
        for (let i = 1; i < n; i++) w[i] = Math.min(w[i], Math.sqrt(Math.max(0, w[i - 1] * w[i - 1] + 2 * Aang * dth[i])));
        for (let i = n - 2; i >= 0; i--) w[i] = Math.min(w[i], Math.sqrt(Math.max(0, w[i + 1] * w[i + 1] + 2 * Aang * dth[i + 1])));
      }
      for (let i = 0; i < n; i++) { const gi = Math.abs(g[i]); const translationInterval = i > 0 && translationPriority[i]; if (!translationInterval && gi > 1e-4) { const vr = w[i] / gi; if (vr < v[i] - 0.05) rotLimited[i] = 1; v[i] = Math.min(v[i], vr); } }
    }
    // forward
    for (let i = 1; i < n; i++) {
      const ds = pts[i].s - pts[i - 1].s;
      const availableAccel = opts.motorMaxSpeed > 1e-6
        ? aFwd[i - 1] * Math.max(0, 1 - Math.abs(v[i - 1]) / opts.motorMaxSpeed)
        : aFwd[i];
      v[i] = Math.min(v[i], Math.sqrt(Math.max(0, v[i - 1] * v[i - 1] + 2 * availableAccel * ds)));
    }
    // backward (dedicated deceleration limit, tightened by ranges)
    for (let i = n - 2; i >= 0; i--) {
      const ds = pts[i + 1].s - pts[i].s;
      v[i] = Math.min(v[i], Math.sqrt(Math.max(0, v[i + 1] * v[i + 1] + 2 * aBack[i] * ds)));
    }
    // local window scale changes omega linearly and alpha quadratically, which
    // avoids the alternating zero-speed samples produced by point-wise caps.
    if (head && head.length === n && Aang > 1e-4) {
      const stopped = new Set(opts.stopIdx || []);
      const intervalDt = (index) => {
        const ds = pts[index].s - pts[index - 1].s;
        return 2 * ds / Math.max(1e-6, v[index - 1] + v[index]);
      };
      const intervalOmega = (index) => {
        const dt = intervalDt(index);
        return dt > 1e-9 ? angWrap(head[index] - head[index - 1]) / dt : 0;
      };
      const translationInterval = (interval) => interval > 0 && interval < n && translationPriority[interval];
      for (let pass = 0; pass < 40; pass++) {
        const caps = v.slice();
        let changed = false;
        for (let interval = 2; interval < n; interval++) {
          if (stopped.has(interval - 1) || translationInterval(interval - 1) || translationInterval(interval)) continue;
          const beforeDt = intervalDt(interval - 1), afterDt = intervalDt(interval);
          if (beforeDt <= 1e-9 || afterDt <= 1e-9) continue;
          const beforeOmega = intervalOmega(interval - 1), afterOmega = intervalOmega(interval);
          const omegaDirection = Math.sign(beforeOmega) || Math.sign(afterOmega);
          const signedAcceleration = omegaDirection * (afterOmega - beforeOmega) / ((beforeDt + afterDt) / 2);
          const measured = Math.abs(signedAcceleration);
          const directionalLimit = beforeOmega * afterOmega < 0
            ? Math.min(Aang, AangDecel)
            : signedAcceleration < 0 ? AangDecel : Aang;
          const localLimit = Math.min(directionalLimit, rangeAngA[interval - 2], rangeAngA[interval - 1], rangeAngA[interval]) * 0.8;
          if (measured <= localLimit * 1.001 + 1e-9) continue;
          const scale = Math.min(0.98, Math.sqrt(localLimit / measured) * 0.98);
          for (let index = interval - 2; index <= interval; index++) {
            if (stopped.has(index)) continue;
            caps[index] = Math.min(caps[index], v[index] * scale);
            rotLimited[index] = Math.max(rotLimited[index], 2);
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
    const t = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const ds = pts[i].s - pts[i - 1].s;
      const vm = (v[i] + v[i - 1]) / 2;
      t[i] = t[i - 1] + (vm > 1e-4 ? ds / vm : 0);
    }
    // Stationary turns happen after arrival and before any wait.
    const turns = [], turnDelay = new Map(); let terminalDelay = 0;
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
    // Endpoint jiggles are compact waypoint actions, not authored geometry.
    const jiggles = [], jiggleDelay = new Map(); let jiggleDistance = 0;
    (opts.jiggles || []).slice().sort((a, b) => a.idx - b.idx).forEach((jiggle) => {
      if (jiggle.idx < 0 || jiggle.idx >= n || !jiggle.config || !(jiggle.config.strokeTimeS > 0)) return;
      const strokeDuration = feasibleJiggleStrokeDuration(jiggle.config.strokeTimeS, jiggle.config.distanceM, vLimit[jiggle.idx], aFwd[jiggle.idx], aBack[jiggle.idx], Math.max(1e-9, opts.freeSpeed || vmax));
      const duration = strokeDuration * jiggle.config.strokes;
      const t0 = t[jiggle.idx] + (turnDelay.get(jiggle.idx) || 0);
      jiggles.push({ ...jiggle, strokeDuration, t0, t1: t0 + duration });
      jiggleDistance += jiggle.config.distanceM * 2 * jiggle.config.strokes;
      jiggleDelay.set(jiggle.idx, duration);
      for (let j = jiggle.idx + 1; j < n; j++) t[j] += duration;
      if (jiggle.idx === n - 1) terminalDelay += duration;
    });
    // dwell / wait-at-waypoint holds (memo §15) — only meaningful at stop points
    const holds = [];
    const dwell = (opts.dwell || []).slice().sort((a, b) => a.idx - b.idx);
    for (let d = 0; d < dwell.length; d++) {
      const dw = dwell[d]; if (!(dw.wait > 0) || dw.idx < 0 || dw.idx >= n) continue;
      const t0 = t[dw.idx] + (turnDelay.get(dw.idx) || 0) + (jiggleDelay.get(dw.idx) || 0); holds.push({ idx: dw.idx, t0, t1: t0 + dw.wait });
      for (let j = dw.idx + 1; j < n; j++) t[j] += dw.wait;
      if (dw.idx === n - 1) terminalDelay += dw.wait;
    }
    return { v, t, totalTime: t[n - 1] + terminalDelay, holds, turns, jiggles, actionDistance: jiggleDistance, rotLimited };
  }

  // pose at time given sampled pts, profile times, and heading anchors / mode
  function poseAtTime(time, pts, prof, anchors, mode, rev) {
    const n = pts.length;
    if (n < 2) return null;
    const T = prof.t;
    // wait/dwell hold: robot is stationary at the stop point for the dwell window (memo §15)
    if (prof.holds && prof.holds.length) {
      for (let k = 0; k < prof.holds.length; k++) {
        const hd = prof.holds[k];
        if (time >= hd.t0 - 1e-9 && time <= hd.t1 + 1e-9) {
          const p = pts[hd.idx]; const f = pts[n - 1].s > 1e-6 ? p.s / pts[n - 1].s : 0;
          let heading = Number.isFinite(hd.heading) ? hd.heading : mode === 'tank' ? p.heading : headingAt(f, anchors); if (rev) heading += Math.PI;
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
          let heading;
          if (turn.headingSamples && turn.headingSamples.length) {
            let before = turn.headingSamples[0], after = turn.headingSamples[turn.headingSamples.length - 1];
            for (let i = 1; i < turn.headingSamples.length; i++) {
              if (turn.headingSamples[i].t >= time) { before = turn.headingSamples[i - 1]; after = turn.headingSamples[i]; break; }
            }
            const span = Math.max(1e-9, after.t - before.t);
            heading = before.heading + angWrap(after.heading - before.heading) * Math.max(0, Math.min(1, (time - before.t) / span));
          } else heading = turn.start + turn.delta * q;
          if (rev) heading += Math.PI;
          return { x: p.x, y: p.y, heading, speed: 0, s: p.s, f, turn: true };
        }
      }
    }
    if (prof.jiggles && prof.jiggles.length) {
      for (let k = 0; k < prof.jiggles.length; k++) {
        const jiggle = prof.jiggles[k];
        if (time < jiggle.t0 - 1e-9 || time > jiggle.t1 + 1e-9) continue;
        const p = pts[jiggle.idx], config = jiggle.config;
        const elapsed = Math.max(0, Math.min(jiggle.t1 - jiggle.t0, time - jiggle.t0));
        const stroke = Math.min(config.strokes - 1, Math.floor(elapsed / jiggle.strokeDuration));
        const strokeElapsed = elapsed - stroke * jiggle.strokeDuration;
        const u = stroke === config.strokes - 1 && elapsed >= jiggle.t1 - jiggle.t0 ? 1 : strokeElapsed / jiggle.strokeDuration;
        const phase = jigglePhase(u), physicalBase = jiggle.baseRad + (rev ? Math.PI : 0);
        const angle = physicalBase + (config.startDeg + config.stepDeg * stroke) * D2R;
        const radial = config.distanceM * phase.position;
        const heading = jiggle.tank ? angle + (u > 0.5 ? Math.PI : 0) : physicalBase;
        return {
          x: p.x + Math.cos(angle) * radial,
          y: p.y + Math.sin(angle) * radial,
          heading,
          speed: Math.abs(phase.velocity) * config.distanceM / jiggle.strokeDuration,
          s: p.s + stroke * config.distanceM * 2 + config.distanceM * phase.travel,
          f: Number.isFinite(p.f) ? p.f : jiggle.idx / Math.max(1, pts.length - 1),
          jiggle: true,
        };
      }
    }
    let i = 1;
    if (time <= 0) i = 1; else if (time >= T[n - 1]) i = n - 1;
    else { // binary search
      let lo = 1, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] < time) lo = mid + 1; else hi = mid; }
      i = lo;
    }
    let t0 = T[i - 1], departureHeading = null; const t1 = T[i];
    for (const actions of [prof.turns, prof.jiggles, prof.holds]) {
      if (!actions) continue;
      for (const action of actions) {
        if (action.idx !== i - 1 || action.t1 <= t0) continue;
        t0 = action.t1;
        if (action.headingSamples && action.headingSamples.length) departureHeading = action.headingSamples[action.headingSamples.length - 1].heading;
        else if (Number.isFinite(action.start) && Number.isFinite(action.delta)) departureHeading = action.start + action.delta;
        else if (Number.isFinite(action.heading)) departureHeading = action.heading;
        else if (Number.isFinite(action.baseRad)) departureHeading = action.baseRad;
      }
    }
    const u = t1 - t0 > 1e-6 ? Math.max(0, Math.min(1, (time - t0) / (t1 - t0))) : 0;
    const a = pts[i - 1], b = pts[i];
    const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
    const s = lerp(a.s, b.s, u);
    const f = pts[n - 1].s > 1e-6 ? s / pts[n - 1].s : 0;
    let heading;
    if (prof.head && prof.head.length === n) {
      const startHeading = departureHeading == null ? prof.head[i - 1] : departureHeading;
      heading = startHeading + angWrap(prof.head[i] - startHeading) * u;
    } else if (mode === 'tank') heading = Math.atan2(b.y - a.y, b.x - a.x);
    else heading = headingAt(f, anchors);
    if (rev) heading += Math.PI;
    const speed = lerp(prof.v[i - 1], prof.v[i], u);
    return { x, y, heading, speed, s, f };
  }

  // Return distinct ordered visits near a field point. Unlike nearestFraction,
  // this projects onto polyline edges and keeps spatially coincident passes
  // separate when they occur at different distances along the path.
  function nearestVisits(wx, wy, pts, options) {
    if (!pts || pts.length < 2) return [];
    const opts = options || {}, total = pts[pts.length - 1].s || 0;
    const requestedTolerance = Number.isFinite(opts.tolerance) ? Math.max(0, opts.tolerance) : null;
    let minimum = Infinity;
    const nearby = [];
    const projectEdge = (i) => {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const u = length2 > 1e-12 ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / length2)) : 0;
      const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), distance = Math.hypot(wx - x, wy - y);
      return { a, b, u, x, y, distance };
    };
    const candidateFor = (projection, edge) => {
      const { a, b, u, x, y, distance } = projection;
      const sameSegment = Number.isInteger(a.seg) && a.seg === b.seg;
      const seg = sameSegment ? a.seg : (u < 0.5 && Number.isInteger(a.seg) ? a.seg : (Number.isInteger(b.seg) ? b.seg : 0));
      const aT = sameSegment && Number.isFinite(a.t) ? a.t : 0;
      const bT = sameSegment && Number.isFinite(b.t) ? b.t : 1;
      const s = lerp(Number.isFinite(a.s) ? a.s : 0, Number.isFinite(b.s) ? b.s : total, u);
      return { x, y, s, f: total > 1e-9 ? s / total : 0, seg, t: lerp(aT, bT, u), heading: angLerp(a.heading || 0, b.heading || 0, u), distance, edge };
    };
    for (let i = 1; i < pts.length; i++) {
      const projection = projectEdge(i);
      minimum = Math.min(minimum, projection.distance);
      if (requestedTolerance != null && projection.distance <= requestedTolerance + 1e-9) nearby.push(candidateFor(projection, i - 1));
    }
    if (requestedTolerance == null || minimum > requestedTolerance + 1e-9) {
      nearby.length = 0;
      for (let i = 1; i < pts.length; i++) {
        const projection = projectEdge(i);
        if (projection.distance <= minimum + 1e-9) nearby.push(candidateFor(projection, i - 1));
      }
    }
    const clusters = [];
    nearby.forEach((candidate) => {
      const cluster = clusters[clusters.length - 1];
      // One traversal can contribute several adjacent polyline edges inside the
      // hit radius. Keep that entire ordered edge run as one pass; arclength
      // spacing varies with sampling density and must not split it apart.
      if (!cluster || candidate.edge > cluster.lastEdge + 1) clusters.push({ lastEdge: candidate.edge, best: candidate });
      else {
        cluster.lastEdge = candidate.edge;
        if (candidate.distance < cluster.best.distance - 1e-9) cluster.best = candidate;
      }
    });
    return clusters.map((cluster) => cluster.best).sort((a, b) => a.s - b.s);
  }

  // ---- per-point engineering metrics aligned to the sampled path ----
  // returns arrays + maxima for velocity / acceleration / angular velocity / curvature
  function metrics(pts, prof, anchors, mode) {
    const n = pts.length;
    const v = prof.v && prof.v.length ? prof.v : new Array(n).fill(0);
    const t = prof.t && prof.t.length ? prof.t : new Array(n).fill(0);
    const accel = new Array(n).fill(0), omega = new Array(n).fill(0), curv = new Array(n).fill(0), head = new Array(n).fill(0);
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
    let vMax = 0.1, aMax = 0.1, wMax = 0.01, kMax = 0;
    for (let i = 0; i < n; i++) {
      vMax = Math.max(vMax, v[i]); aMax = Math.max(aMax, Math.abs(accel[i]));
      wMax = Math.max(wMax, Math.abs(omega[i])); kMax = Math.max(kMax, Math.abs(curv[i]));
    }
    return { v, accel, omega, curv, head, vMax, aMax, wMax, kMax };
  }

  // ---- path checks ----------------------------------------------------------
  // Only measured constraint violations are issues. Expected slowdowns are
  // neutral notes so the UI never calls normal planner behavior a failure.
  function analyze(pts, prof, m, context) {
    const n = pts.length, checks = [], cfg = context || {}, constraints = cfg.constraints || {};
    if (n < 2) return [{ f: 0, kind: 'geometry', level: 'error', text: 'Path needs at least two distinct samples' }];
    const totalS = pts[n - 1].s || 1;
    const finite = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.s))
      && [prof.totalTime, m.vMax, m.aMax, m.wMax, m.kMax].every(Number.isFinite);
    if (!finite) return [{ f: 0, kind: 'geometry', level: 'error', text: 'Trajectory contains invalid numeric values' }];

    let accelAt = 0, accelPeak = 0, decelAt = 0, decelPeak = 0, omegaAt = 0, omegaPeak = 0, curvatureAt = 0, curvaturePeak = 0;
    for (let i = 0; i < n; i++) {
      if (m.accel[i] > accelPeak) { accelPeak = m.accel[i]; accelAt = i; }
      if (-m.accel[i] > decelPeak) { decelPeak = -m.accel[i]; decelAt = i; }
      if (Math.abs(m.omega[i]) > omegaPeak) { omegaPeak = Math.abs(m.omega[i]); omegaAt = i; }
      if (Math.abs(m.curv[i]) > curvaturePeak) { curvaturePeak = Math.abs(m.curv[i]); curvatureAt = i; }
    }
    const at = (index) => pts[index].s / totalS;
    if (constraints.maxAccel > 0 && accelPeak > constraints.maxAccel * 1.025)
      checks.push({ f: at(accelAt), kind: 'constraint', level: 'warning', text: 'Acceleration exceeds limit \u00b7 ' + accelPeak.toFixed(1) + ' m/s\u00b2' });
    const maxDecel = constraints.maxDecel > 0 ? constraints.maxDecel : constraints.maxAccel;
    if (maxDecel > 0 && decelPeak > maxDecel * 1.025)
      checks.push({ f: at(decelAt), kind: 'constraint', level: 'warning', text: 'Deceleration exceeds limit \u00b7 ' + decelPeak.toFixed(1) + ' m/s\u00b2' });
    const omegaLimit = (constraints.maxAngVel || 0) * D2R;
    if (omegaLimit > 0 && omegaPeak > omegaLimit * 1.025)
      checks.push({ f: at(omegaAt), kind: 'constraint', level: 'warning', text: 'Angular velocity exceeds limit \u00b7 ' + (omegaPeak / D2R).toFixed(0) + '\u00b0/s' });

    if (curvaturePeak > 1e-6 && constraints.maxVel > 0 && constraints.maxAccel > 0) {
      const cornerAcceleration = constraints.maxCentripetalAccel != null ? constraints.maxCentripetalAccel : constraints.maxAccel;
      const curveLimit = Math.sqrt(cornerAcceleration / curvaturePeak);
      if (curveLimit < constraints.maxVel * 0.7) {
        const planned = Math.min(curveLimit, m.v[curvatureAt] || curveLimit);
        checks.push({ f: at(curvatureAt), kind: 'performance', level: 'note', text: 'Turn limits speed to ' + planned.toFixed(1) + ' m/s' });
      }
    }
    return checks;
  }

  function headingWithTranslationPriority(doc, robot, pts, prof, desired, ranges, transitions) {
    transitions = transitions || [];
    if (!robot || robot.drive === 'tank' || (!ranges.some((range) => range.rotationPriority === 'translation') && !transitions.some((transition) => transition.rotationPriority === 'translation')) || desired.length < 2) return desired;
    const out = desired.slice();
    let following = false, actual = desired[0], omega = 0;
    const total = pts[pts.length - 1].s || 1;
    const intervalPolicies = indexIntervalPolicies(
      pts.map((point) => point.s / total),
      ranges.map((range) => ({ ...range, start: Math.min(range.f0, range.f1), end: Math.max(range.f0, range.f1) })),
      transitions,
    );
    for (let i = 1; i < desired.length; i++) {
      const dt = prof.t[i] - prof.t[i - 1];
      const previousDt = i > 1 ? prof.t[i - 1] - prof.t[i - 2] : 0;
      const plannedOmega = previousDt > 1e-9 ? angWrap(desired[i - 1] - desired[i - 2]) / previousDt : 0;
      const caughtUp = Math.abs(desired[i - 1] - actual) <= 0.05 * D2R && Math.abs(plannedOmega - omega) <= 0.05 * D2R;
      following = intervalPolicies.activeTranslationPriority[i] || (following && !caughtUp);
      if (!following || dt <= 1e-9) { actual = desired[i]; omega = dt > 1e-9 ? angWrap(desired[i] - desired[i - 1]) / dt : omega; out[i] = actual; continue; }
      const maxOmega = Math.min(doc.constraints.maxAngVel || 0, intervalPolicies.maxAngVel[i]) * D2R;
      const maxAccel = Math.min(doc.constraints.maxAngAccel || 0, intervalPolicies.maxAngAccel[i]) * D2R;
      const maxDecel = Math.min(doc.constraints.maxAngDecel || doc.constraints.maxAngAccel || 0, intervalPolicies.maxAngAccel[i]) * D2R;
      const error = desired[i] - actual;
      const desiredOmega = Math.max(-maxOmega, Math.min(maxOmega, (desired[i] - desired[i - 1]) / dt));
      const brakingOmega = Math.max(0, Math.sqrt(2 * Math.max(1e-9, maxDecel) * Math.abs(error)) - Math.max(1e-9, maxDecel) * dt);
      const catchUpOmega = Math.sign(error) * brakingOmega;
      let target = Math.max(-maxOmega, Math.min(maxOmega, desiredOmega + catchUpOmega));
      const exactOmega = error / dt;
      const exactReversing = Math.sign(exactOmega) !== 0 && Math.sign(omega) !== 0 && Math.sign(exactOmega) !== Math.sign(omega);
      const exactRate = exactReversing ? Math.min(maxAccel, maxDecel) : Math.abs(exactOmega) > Math.abs(omega) ? maxAccel : maxDecel;
      if (Math.abs(exactOmega) <= maxOmega + 1e-9 && Math.abs(exactOmega - omega) <= exactRate * dt + 1e-9) target = exactOmega;
      const reversing = Math.sign(target) !== 0 && Math.sign(omega) !== 0 && Math.sign(target) !== Math.sign(omega);
      const increasing = Math.sign(target) === Math.sign(omega) && Math.abs(target) > Math.abs(omega);
      const rate = reversing ? Math.min(maxAccel, maxDecel) : increasing ? maxAccel : maxDecel;
      const change = Math.max(1e-9, rate) * dt;
      omega += Math.max(-change, Math.min(change, target - omega));
      actual += omega * dt;
      out[i] = actual;
    }
    out.terminalOmega = omega;
    return out;
  }

  function appendTerminalHeadingCatchup(doc, prof, tracked, desired, ranges) {
    const last = tracked.length - 1;
    if (last < 1 || Math.abs(prof.v[last] || 0) > 1e-3) return;
    let actual = tracked[last], omega = tracked.terminalOmega || 0;
    const target = desired[last], errorAtArrival = target - actual;
    if (Math.abs(errorAtArrival) <= 0.05 * D2R && Math.abs(omega) <= 0.05 * D2R) return;
    let period = Infinity;
    for (let i = 1; i < prof.t.length; i++) { const dt = prof.t[i] - prof.t[i - 1]; if (dt > 1e-9) period = Math.min(period, dt); }
    period = isFinite(period) ? Math.max(0.01, Math.min(0.05, period)) : 0.02;
    const active = ranges.filter((range) => 1 >= Math.min(range.f0, range.f1) - 1e-9 && 1 <= Math.max(range.f0, range.f1) + 1e-9);
    let maxOmega = (doc.constraints.maxAngVel || 0) * D2R;
    let maxAccel = (doc.constraints.maxAngAccel || 0) * D2R;
    let maxDecel = (doc.constraints.maxAngDecel || doc.constraints.maxAngAccel || 0) * D2R;
    active.forEach((range) => {
      maxOmega = Math.min(maxOmega, range.maxAngVel * D2R);
      maxAccel = Math.min(maxAccel, range.maxAngAccel * D2R);
      maxDecel = Math.min(maxDecel, range.maxAngAccel * D2R);
    });
    let ticks = 0;
    while ((Math.abs(target - actual) > 0.05 * D2R || Math.abs(omega) > 0.05 * D2R) && ticks < 250000) {
      const error = target - actual;
      const brakingOmega = Math.max(0, Math.sqrt(2 * Math.max(1e-9, maxDecel) * Math.abs(error)) - Math.max(1e-9, maxDecel) * period);
      let nextTarget = Math.max(-maxOmega, Math.min(maxOmega, Math.sign(error) * brakingOmega));
      const exactOmega = error / period;
      const exactReversing = Math.sign(exactOmega) !== 0 && Math.sign(omega) !== 0 && Math.sign(exactOmega) !== Math.sign(omega);
      const exactRate = exactReversing ? Math.min(maxAccel, maxDecel) : Math.abs(exactOmega) > Math.abs(omega) ? maxAccel : maxDecel;
      if (Math.abs(exactOmega) <= maxOmega + 1e-9 && Math.abs(exactOmega - omega) <= exactRate * period + 1e-9) nextTarget = exactOmega;
      const reversing = Math.sign(nextTarget) !== 0 && Math.sign(omega) !== 0 && Math.sign(nextTarget) !== Math.sign(omega);
      const increasing = Math.sign(nextTarget) === Math.sign(omega) && Math.abs(nextTarget) > Math.abs(omega);
      const rate = reversing ? Math.min(maxAccel, maxDecel) : increasing ? maxAccel : maxDecel;
      omega += Math.max(-rate * period, Math.min(rate * period, nextTarget - omega));
      actual += omega * period;
      ticks++;
    }
    if (Math.abs(target - actual) > 0.05 * D2R || Math.abs(omega) > 0.05 * D2R) { prof.headingCatchupFailed = true; return; }
    const duration = ticks * period, arrival = prof.t[last];
    (prof.turns || []).forEach((turn) => { if (turn.idx === last) { turn.t0 += duration; turn.t1 += duration; } });
    (prof.jiggles || []).forEach((jiggle) => { if (jiggle.idx === last) { jiggle.t0 += duration; jiggle.t1 += duration; } });
    (prof.holds || []).forEach((hold) => { if (hold.idx === last) { hold.t0 += duration; hold.t1 += duration; } });
    prof.turns = prof.turns || [];
    prof.turns.push({ idx: last, t0: arrival, t1: arrival + duration, start: tracked[last], delta: target - tracked[last], catchup: true });
    prof.totalTime += duration;
    prof.headingCatchupDuration = duration;
  }

  // ---- one-call derivation: everything the field + panels need for a path ----
  function derivePath(doc, robot, perSeg, plannerId) {
    perSeg = perSeg || 56;
    const hardLimits = robotHardLimits(robot);
    if (hardLimits) {
      robot = { ...robot, maxSpeed: hardLimits.maxSpeed };
      doc = { ...doc, constraints: effectiveConstraints(doc.constraints, robot) };
    }
    const smp = sample(doc.waypoints, perSeg);
    const nWp = doc.waypoints.length;
    const originalLast = Math.max(0, smp.pts.length - 1);
    let wpIdx = (smp.wpIdx || doc.waypoints.map((_, k) => Math.min(originalLast, k * perSeg))).slice();
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
    const lastI = Math.max(0, pts.length - 1);
    const total = smp.length || 1;
    const wpFrac = wpIdx.map((i) => (pts.length ? pts[i].s / total : 0));
    const stopIdx = [];
    doc.waypoints.forEach((w, k) => { if (w.stop) stopIdx.push(wpIdx[k]); });
    const cap = (robot && robot.maxSpeed) || doc.constraints.maxVel;
    const vmax = Math.min(doc.constraints.maxVel, cap);
    const sv = doc.waypoints[0] && doc.waypoints[0].stop ? 0 : doc.startVel;
    const gv = doc.waypoints[nWp - 1] && doc.waypoints[nWp - 1].stop ? 0 : doc.goalVel;
    const effRanges = effectiveRanges(doc, smp);
    // Heading mode is owned by the outgoing segment; omitted overrides inherit the path default.
    const headingMode = (robot && robot.drive === 'tank') ? 'tangent' : (doc.headingMode || 'targets');
    const effectiveHeadingMode = (segment) => (robot && robot.drive === 'tank')
      ? 'tangent'
      : ((doc.waypoints[segment] && doc.waypoints[segment].segmentHeadingMode) || headingMode);
    const segmentModes = doc.waypoints.slice(0, -1).map((_, segment) => effectiveHeadingMode(segment));
    const manualEntries = [], targetEntries = [];
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
    const rawHead = [];
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
    const mode = allTangent ? 'tank' : 'swerve';
    const dwell = [], turns = [], jiggles = [];
    doc.waypoints.forEach((w, k) => { if (w.stop && w.wait > 0) dwell.push({ idx: wpIdx[k], wait: w.wait }); });
    doc.waypoints.forEach((w, k) => { if (w.stop && w.turnInPlace) turns.push({ idx: wpIdx[k], start: k > 0 ? head[Math.max(0, wpIdx[k] - 1)] : head[0], end: w.turnInPlace.headingDeg * D2R, direction: w.turnInPlace.direction, maxAngVel: doc.constraints.maxAngVel, maxAngAccel: Math.min(doc.constraints.maxAngAccel, doc.constraints.maxAngDecel || doc.constraints.maxAngAccel), maxAngJerk: doc.constraints.maxAngJerk }); });
    const endpoint = doc.waypoints[nWp - 1];
    let invalidJiggle = false, unsupportedJiggle = false;
    if (endpoint && endpoint.jiggle) {
      const baseRad = endpoint.turnInPlace ? endpoint.turnInPlace.headingDeg * D2R : head[lastI];
      const physicalBaseRad = baseRad + (doc.driveBackward ? Math.PI : 0);
      if (robot && robot.drive === 'tank') unsupportedJiggle = true;
      else if (jigglePositions(endpoint, physicalBaseRad, endpoint.jiggle)) {
        jiggles.push({ idx: wpIdx[nWp - 1], baseRad, config: endpoint.jiggle });
      } else invalidJiggle = true;
    }
    const prof = profile(pts, doc.constraints, sv, gv, { stopIdx, vmax, ranges: effRanges, headingTransitions, heading: head, dwell, turns, jiggles, freeSpeed: cap, motorMaxSpeed: hardLimits ? cap : 0 });
    const trackedHead = headingWithTranslationPriority(doc, robot, pts, prof, head, effRanges, headingTransitions);
    prof.head = trackedHead;
    appendTerminalHeadingCatchup(doc, prof, trackedHead, head, effRanges);
    const anchors = mode === 'tank' ? [] : buildAnchors(pts.map((p, i) => ({ f: total > 1e-6 ? p.s / total : 0, rad: trackedHead[i] })));
    const mtr = metrics(pts, prof, anchors, mode);
    const checks = analyze(pts, prof, mtr, {
      constraints: doc.constraints,
      plannerId: 'profiledSpline',
    });
    doc.waypoints.slice(0, -1).forEach((w, segment) => {
      if (w.segmentHeadingMode !== 'lookAt' || !w.segmentLookAt) return;
      let nearest = Infinity;
      for (let i = wpIdx[segment]; i <= wpIdx[segment + 1] && i < pts.length; i++) nearest = Math.min(nearest, Math.hypot(pts[i].x - w.segmentLookAt.x, pts[i].y - w.segmentLookAt.y));
      if (nearest < 0.05) checks.push({ f: wpFrac[segment], kind: 'lookAt', level: 'error', text: 'Tracked field point lies on the driven segment' });
    });
    if (invalidJiggle) checks.push({ f: 1, kind: 'jiggle', level: 'error', text: 'Jiggle directions must be unique and stay on the field' });
    if (unsupportedJiggle) checks.push({ f: 1, kind: 'jiggle', level: 'error', text: 'Arbitrary-direction jiggle requires swerve drive' });
    if (prof.headingCatchupFailed) checks.push({ f: 1, kind: 'rotation', level: 'error', text: 'Final heading cannot settle within the trajectory sample limit' });
    // Rotation limiting is expected planner behavior, so report it as a note.
    if (prof.rotLimited) {
      const rl = prof.rotLimited;
      let run = -1, longest = null;
      const consider = (a, b) => { if (b - a > 3 && (!longest || b - a > longest[1] - longest[0])) longest = [a, b]; };
      for (let i = 0; i < rl.length; i++) { if (rl[i]) { if (run < 0) run = i; } else if (run >= 0) { consider(run, i - 1); run = -1; } }
      if (run >= 0) consider(run, rl.length - 1);
      if (longest) {
        const mid = Math.floor((longest[0] + longest[1]) / 2);
        const accelerationLimited = rl.slice(longest[0], longest[1] + 1).some((value) => value >= 2);
        checks.push({
          f: pts[mid].s / total,
          kind: 'performance',
          level: 'note',
          text: accelerationLimited
            ? 'Angular acceleration limits speed · add more distance between heading anchors'
            : 'Angular velocity limits speed through this stretch',
        });
      }
    }
    checks.forEach((check) => {
      let seg = 0;
      for (let i = 0; i < wpFrac.length - 1; i++) { if (check.f >= wpFrac[i] - 1e-4) seg = i; }
      check.seg = Math.max(0, Math.min(doc.waypoints.length - 2, seg));
    });
    return { sample: smp, prof, totalDistance: smp.length + (prof.actionDistance || 0), anchors, metrics: mtr, checks, wpFrac, wpIdx, mode, effRanges, headingMode, rev: !!doc.driveBackward, playback: null, markers: [], planner: 'profiledSpline' };
  }

  function jigglePositions(anchor, baseRad, options, bounds = { w: 17.548, h: 8.052 }) {
    const distance = Number(options.distanceM != null ? options.distanceM : options.distance), strokes = Math.round(Number(options.strokes)), startDeg = Number(options.startDeg), stepDeg = Number(options.stepDeg);
    if (!(distance >= 0.03) || strokes < 2 || strokes > 12 || !Number.isFinite(startDeg + stepDeg)) return null;
    const directions = new Set(), positions = [];
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

  function pathLength(waypoints, perSegment = 56) { return sample(waypoints, perSegment).length; }

export const PM = { splitBezier, nearestPointOnSegment, poseAtTime, headingAt, metricColor, metricGradient, METRICS, SEGTYPES, pointAtFraction, nearestFraction, nearestVisits, autoHandles, angWrap, derivePath, jigglePositions, featureFraction, reversePathAnchors, pathLength, remapWaypointRange, waypointFracs, robotHardLimits, effectiveConstraints, indexIntervalPolicies };
