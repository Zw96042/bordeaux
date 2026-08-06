// Bordeaux — path math engine (no React). Exports to window.PM
(function () {
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

  // ---- rebuilt LabVIEW compatibility geometry ------------------------------
  // These are browser copies of the shared compatibility planners. Keep their
  // constants and endpoint derivative formulas aligned with src/shared/math.
  const LV_EPS = 1e-10, LV_TAU_STEP = 0.001;
  const lvAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const lvSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const lvScale = (p, n) => ({ x: p.x * n, y: p.y * n });
  const lvMag = (p) => Math.hypot(p.x, p.y);
  function lvFallbackTangent(wps, i) {
    if (i === 0) return lvSub(wps[1], wps[0]);
    if (i === wps.length - 1) return lvSub(wps[i], wps[i - 1]);
    const ld = lvMag(lvSub(wps[i], wps[i - 1])), rd = lvMag(lvSub(wps[i + 1], wps[i]));
    const dir = lvAdd(lvScale(lvSub(wps[i], wps[i - 1]), 1 / Math.max(ld, LV_EPS)), lvScale(lvSub(wps[i + 1], wps[i]), 1 / Math.max(rd, LV_EPS)));
    return lvMag(dir) <= LV_EPS ? { x: 0, y: 0 } : lvScale(dir, 0.5 * Math.min(ld, rd) / lvMag(dir));
  }
  function lvTangents(wps) {
    return wps.map((w, i) => {
      const incoming = w.prevC ? lvScale(lvSub(w, w.prevC), 5) : null;
      const outgoing = w.nextC ? lvScale(lvSub(w.nextC, w), 5) : null;
      const hasIn = incoming && lvMag(incoming) > LV_EPS, hasOut = outgoing && lvMag(outgoing) > LV_EPS;
      if (i === 0 && hasOut) return outgoing;
      if (i === wps.length - 1 && hasIn) return incoming;
      if (hasIn && hasOut) { const avg = lvScale(lvAdd(incoming, outgoing), 0.5); if (lvMag(avg) > LV_EPS) return avg; }
      return hasOut ? outgoing : hasIn ? incoming : lvFallbackTangent(wps, i);
    });
  }
  function lvCubicSecond(a, b, ta, tb) {
    const p1 = lvAdd(a, lvScale(ta, 1 / 3)), p2 = lvSub(b, lvScale(tb, 1 / 3));
    return { start: lvScale(lvAdd(lvSub(a, lvScale(p1, 2)), p2), 6), end: lvScale(lvAdd(lvSub(p1, lvScale(p2, 2)), b), 6) };
  }
  function lvSecondDerivatives(wps, tangents) {
    const cubics = [], chords = [];
    for (let i = 0; i < wps.length - 1; i++) { cubics.push(lvCubicSecond(wps[i], wps[i + 1], tangents[i], tangents[i + 1])); chords.push(lvMag(lvSub(wps[i + 1], wps[i]))); }
    const out = [cubics[0].start];
    for (let i = 1; i < wps.length - 1; i++) {
      const lw = 1 / Math.max(chords[i - 1], LV_EPS), rw = 1 / Math.max(chords[i], LV_EPS);
      out.push(lvScale(lvAdd(lvScale(cubics[i - 1].end, lw), lvScale(cubics[i].start, rw)), 1 / (lw + rw)));
    }
    out.push(cubics[cubics.length - 1].end); return out;
  }
  function lvQuinticControls(a, b, ta, tb, aa, ab) {
    const p1 = lvAdd(a, lvScale(ta, 1 / 5)), p4 = lvSub(b, lvScale(tb, 1 / 5));
    return [a, p1, lvAdd(lvAdd(lvScale(aa, 1 / 20), lvScale(p1, 2)), lvScale(a, -1)), lvAdd(lvAdd(lvScale(ab, 1 / 20), lvScale(p4, 2)), lvScale(b, -1)), p4, b];
  }
  function lvEval(cp, t) {
    const p = cp.map((v) => ({ ...v }));
    for (let level = p.length - 1; level > 0; level--) for (let i = 0; i < level; i++) p[i] = { x: lerp(p[i].x, p[i + 1].x, t), y: lerp(p[i].y, p[i + 1].y, t) };
    return p[0];
  }
  function lvDerivativeControls(cp) { const n = cp.length - 1; return cp.slice(0, -1).map((p, i) => lvScale(lvSub(cp[i + 1], p), n)); }
  function lvBezierPiece(raw, mode, segmentOffset) {
    const wps = raw.map((w) => ({ x: w.x, y: w.y, prevC: w.prevC, nextC: w.nextC }));
    if (mode === 'automatic') {
      wps.forEach((w) => { delete w.prevC; delete w.nextC; });
      const firstChord = lvMag(lvSub(wps[1], wps[0])), last = wps.length - 1, lastChord = lvMag(lvSub(wps[last], wps[last - 1]));
      const a0 = (raw[0].theta || 0) * D2R, a1 = (raw[last].theta || 0) * D2R;
      wps[0].nextC = { x: wps[0].x + Math.cos(a0) * firstChord / 5, y: wps[0].y + Math.sin(a0) * firstChord / 5 };
      wps[last].prevC = { x: wps[last].x - Math.cos(a1) * lastChord / 5, y: wps[last].y - Math.sin(a1) * lastChord / 5 };
    }
    const tangents = lvTangents(wps), seconds = lvSecondDerivatives(wps, tangents), pts = [], steps = 240;
    for (let seg = 0; seg < wps.length - 1; seg++) {
      const cp = lvQuinticControls(wps[seg], wps[seg + 1], tangents[seg], tangents[seg + 1], seconds[seg], seconds[seg + 1]);
      const dcp = lvDerivativeControls(cp), ddcp = lvDerivativeControls(dcp);
      for (let k = 0; k <= steps; k++) {
        if (seg && k === 0) continue;
        const t = k / steps, pos = lvEval(cp, t), d = lvEval(dcp, t), dd = lvEval(ddcp, t), speed2 = d.x * d.x + d.y * d.y;
        pts.push({ x: pos.x, y: pos.y, seg: segmentOffset + seg, t, heading: Math.atan2(d.y, d.x), curv: speed2 > LV_EPS ? Math.abs(d.x * dd.y - d.y * dd.x) / Math.pow(speed2, 1.5) : 0, s: 0 });
      }
    }
    return pts;
  }
  function labviewBezierSample(raw, mode) {
    const pts = []; let start = 0;
    for (let end = 1; end < raw.length; end++) {
      if (!(raw[end].stop || end === raw.length - 1)) continue;
      const piece = lvBezierPiece(raw.slice(start, end + 1), mode, start);
      piece.forEach((p, i) => { if (pts.length && i === 0) return; pts.push(p); });
      start = end;
    }
    const sample = lvFinishSample(lvDensify(pts), raw.length - 1);
    sample.wpIdx = lvNearestWaypointIndices(raw, sample.pts); return sample;
  }

  function lvUnit(v) { const n = lvMag(v); if (n <= LV_EPS) throw new Error('LabVIEW clothoid waypoints must not overlap'); return lvScale(v, 1 / n); }
  function lvCross(a, b) { return a.x * b.y - a.y * b.x; }
  function lvDot(a, b) { return a.x * b.x + a.y * b.y; }
  function lvRotate(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: c * v.x - s * v.y, y: s * v.x + c * v.y }; }
  function lvReflect(v, axisAngle) { const axis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) }, p = 2 * lvDot(v, axis); return { x: p * axis.x - v.x, y: p * axis.y - v.y }; }
  function lvCanonicalBlend(turn, radius) {
    const sign = Math.sign(turn), absTurn = Math.abs(turn), spiralTurn = Math.min(absTurn, Math.PI / 2), halfHeading = spiralTurn / 2;
    const tauMax = Math.sqrt(halfHeading), sigma = 2 * radius * tauMax, extraArc = absTurn - spiralTurn;
    const entry = [{ x: 0, y: 0, heading: 0, curvature: 0 }]; let tau = 0, x = 0, y = 0;
    while (tau < tauMax - Number.EPSILON) {
      const step = Math.min(LV_TAU_STEP, tauMax - tau), heading = sign * tau * tau;
      x += sigma * Math.cos(heading) * step; y += sigma * Math.sin(heading) * step; tau += step;
      entry.push({ x, y, heading: sign * tau * tau, curvature: sign * 2 * tau / sigma });
    }
    const local = entry.slice(); let exitStart = entry[entry.length - 1];
    if (extraArc > 1e-6) {
      const startHeading = sign * halfHeading, normal = { x: -Math.sin(startHeading) * sign, y: Math.cos(startHeading) * sign };
      const center = { x: exitStart.x + normal.x * radius, y: exitStart.y + normal.y * radius }, radialStart = Math.atan2(exitStart.y - center.y, exitStart.x - center.x);
      const count = Math.max(1, Math.ceil(extraArc / Math.max(1e-6, sigma * LV_TAU_STEP / radius)));
      for (let i = 1; i <= count; i++) { const swept = extraArc * i / count, radial = radialStart + sign * swept; exitStart = { x: center.x + radius * Math.cos(radial), y: center.y + radius * Math.sin(radial), heading: sign * (halfHeading + swept), curvature: sign / radius }; local.push(exitStart); }
    }
    let current = exitStart;
    for (let i = entry.length - 1; i > 0; i--) { const reflected = lvReflect(lvSub(entry[i], entry[i - 1]), turn / 2); current = { x: current.x + reflected.x, y: current.y + reflected.y, heading: turn - entry[i - 1].heading, curvature: entry[i - 1].curvature }; local.push(current); }
    return local;
  }
  function lvCorner(wps, i, radius) {
    const incoming = lvUnit(lvSub(wps[i], wps[i - 1])), outgoing = lvUnit(lvSub(wps[i + 1], wps[i]));
    const turn = Math.atan2(lvCross(incoming, outgoing), lvDot(incoming, outgoing)); if (Math.abs(turn) <= 1e-6) return null;
    if (Math.abs(Math.PI - Math.abs(turn)) <= 1e-6) throw new Error('LabVIEW clothoid cannot reverse 180 degrees');
    const local = lvCanonicalBlend(turn, radius), end = local[local.length - 1], exitTrim = end.y / Math.sin(turn), entryTrim = end.x - exitTrim * Math.cos(turn);
    return { incoming, outgoing, incomingHeading: Math.atan2(incoming.y, incoming.x), local, entryTrim, exitTrim, scale: 1 };
  }
  function lvClothoidPiece(wps, radius) {
    wps = wps.filter((w, i) => i === 0 || lvMag(lvSub(w, wps[i - 1])) > LV_EPS);
    if (wps.length < 2) return wps.length ? [{ x: wps[0].x, y: wps[0].y, heading: 0, curvature: 0 }] : [];
    const recipes = wps.map((_, i) => i > 0 && i < wps.length - 1 ? lvCorner(wps, i, radius) : null);
    for (let i = 0; i < wps.length - 1; i++) {
      const edge = lvMag(lvSub(wps[i + 1], wps[i])), left = i > 0 ? recipes[i] : null, right = i + 1 < wps.length - 1 ? recipes[i + 1] : null;
      const required = (left ? left.exitTrim * left.scale : 0) + (right ? right.entryTrim * right.scale : 0);
      if (required > edge && required > LV_EPS) { const reduction = Math.max(0, (edge - LV_EPS) / required); if (left) left.scale *= reduction; if (right) right.scale *= reduction; }
    }
    const out = [];
    const append = (p) => { const prev = out[out.length - 1]; if (!prev || lvMag(lvSub(p, prev)) > LV_EPS) out.push(p); };
    append({ x: wps[0].x, y: wps[0].y, heading: Math.atan2(wps[1].y - wps[0].y, wps[1].x - wps[0].x), curvature: 0 });
    for (let i = 1; i < wps.length - 1; i++) {
      const r = recipes[i]; if (!r) continue;
      const entry = { x: wps[i].x - r.incoming.x * r.entryTrim * r.scale, y: wps[i].y - r.incoming.y * r.entryTrim * r.scale };
      append({ ...entry, heading: r.incomingHeading, curvature: 0 });
      for (let k = 1; k < r.local.length; k++) { const p = r.local[k], v = lvRotate({ x: p.x * r.scale, y: p.y * r.scale }, r.incomingHeading); append({ x: entry.x + v.x, y: entry.y + v.y, heading: r.incomingHeading + p.heading, curvature: r.scale > LV_EPS ? p.curvature / r.scale : 0 }); }
    }
    const last = wps.length - 1; append({ x: wps[last].x, y: wps[last].y, heading: Math.atan2(wps[last].y - wps[last - 1].y, wps[last].x - wps[last - 1].x), curvature: 0 });
    return out;
  }
  function labviewClothoidSample(raw, radius) {
    const pts = []; let start = 0;
    for (let end = 1; end < raw.length; end++) {
      if (!(raw[end].stop || end === raw.length - 1)) continue;
      const piece = lvClothoidPiece(raw.slice(start, end + 1), radius);
      piece.forEach((p, i) => { if (pts.length && i === 0) return; pts.push({ ...p, curv: Math.abs(p.curvature), seg: Math.min(raw.length - 2, start + Math.max(0, i)), t: 0, s: 0 }); });
      start = end;
    }
    const sample = lvFinishSample(lvDensify(pts), raw.length - 1);
    sample.wpIdx = lvNearestWaypointIndices(raw, sample.pts); return sample;
  }
  function lvNearestWaypointIndices(wps, pts) {
    let floor = 0;
    return wps.map((w) => { let best = floor, bestD = Infinity; for (let i = floor; i < pts.length; i++) { const d = (pts[i].x - w.x) ** 2 + (pts[i].y - w.y) ** 2; if (d < bestD) { bestD = d; best = i; } } floor = best; return best; });
  }
  function lvDensify(pts, maximumSpacing = 0.02) {
    if (pts.length < 2) return pts.slice();
    const out = [{ ...pts[0] }];
    for (let i = 1; i < pts.length; i++) {
      const before = pts[i - 1], after = pts[i], count = Math.max(1, Math.ceil(lvMag(lvSub(after, before)) / maximumSpacing));
      for (let part = 1; part <= count; part++) {
        const u = part / count;
        out.push({ ...after, x: lerp(before.x, after.x, u), y: lerp(before.y, after.y, u), heading: before.heading + angWrap(after.heading - before.heading) * u, curv: lerp(before.curv || 0, after.curv || 0, u), s: 0 });
      }
    }
    return out;
  }
  function lvFinishSample(pts, segs, wpIdx) {
    let s = 0; if (pts[0]) pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) { s += lvMag(lvSub(pts[i], pts[i - 1])); pts[i].s = s; }
    return { pts, length: s, segs, wpIdx };
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
    const aLat = Math.max(0.1, c.maxAccel);
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
      for (let i = 1; i < n; i++) {
        const start = pts[i - 1].s / totalS, end = pts[i].s / totalS;
        const overlaps = (lo, hi) => Math.min(end, hi) - Math.max(start, lo) >= -1e-9;
        const activeRanges = ranges.filter((R) => overlaps(Math.min(R.f0, R.f1), Math.max(R.f0, R.f1)));
        const activeTransitions = headingTransitions.filter((policy) => overlaps(policy.start, policy.end));
        const activePolicies = activeRanges.length + activeTransitions.length;
        translationPriority[i] = activePolicies > 0
          && activeRanges.every((R) => R.rotationPriority === 'translation')
          && activeTransitions.every((policy) => policy.rotationPriority === 'translation');
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
    // Enforce angular acceleration in generated timing instead of manufacturing
    // visible velocity constraint ranges around ordinary moving turns.
    if (head && head.length === n && Aang > 1e-4) {
      const angularBudget = Aang * 0.8;
      const intervalDt = (index, candidate, candidateIndex) => {
        const ds = pts[index].s - pts[index - 1].s;
        const before = candidateIndex === index - 1 ? candidate : v[index - 1];
        const after = candidateIndex === index ? candidate : v[index];
        return 2 * ds / Math.max(1e-6, before + after);
      };
      const intervalOmega = (index, candidate, candidateIndex) => {
        if (index <= 0 || index >= n) return 0;
        const dt = intervalDt(index, candidate, candidateIndex);
        return dt > 1e-9 ? Math.abs(angWrap(head[index] - head[index - 1])) / dt : 0;
      };
      const capInterval = (interval, referenceInterval, variableIndex, referenceDtInterval) => {
        const referenceOmega = intervalOmega(referenceInterval, v[variableIndex], -1);
        const allowed = (candidate) => intervalOmega(interval, candidate, variableIndex) <= referenceOmega + angularBudget * intervalDt(referenceDtInterval, candidate, variableIndex) + 1e-9;
        if (allowed(v[variableIndex])) return false;
        let low = 0, high = v[variableIndex];
        for (let iteration = 0; iteration < 28; iteration++) {
          const candidate = (low + high) / 2;
          if (allowed(candidate)) low = candidate; else high = candidate;
        }
        v[variableIndex] = low;
        return true;
      };
      const stopped = new Set(opts.stopIdx || []);
      const translationInterval = (interval) => interval > 0 && interval < n && translationPriority[interval];
      for (let pass = 0; pass < 20; pass++) {
        let changed = false;
        for (let interval = 2; interval < n; interval++) {
          if (!stopped.has(interval - 1) && !translationInterval(interval)) changed = capInterval(interval, interval - 1, interval, interval) || changed;
        }
        for (let interval = n - 2; interval >= 1; interval--) {
          if (!stopped.has(interval) && !translationInterval(interval)) changed = capInterval(interval, interval + 1, interval - 1, interval + 1) || changed;
        }
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
  }

  window.PM = { bez, bezD, sample, profile, poseAtTime, headingAt, metrics, analyze, metricColor, metricGradient, METRICS, SEGTYPES, buildAnchors, pointAtFraction, nearestFraction, autoHandles, angWrap, angLerp, D2R, R2D, lerp, derivePath, effectiveRanges, waypointFracs };
})();
