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
      const a = s[i], b = s[i + 1];
      if (t >= a[0] && t <= b[0]) {
        const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        const ca = hex2rgb(a[1]), cb = hex2rgb(b[1]);
        return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * u)},${Math.round(ca[1] + (cb[1] - ca[1]) * u)},${Math.round(ca[2] + (cb[2] - ca[2]) * u)})`;
      }
    }
    return s[s.length - 1][1];
  }
  function metricGradient(mode) {
    const s = RAMPS_M[mode] || RAMPS_M.velocity;
    return 'linear-gradient(90deg,' + s.map((x) => x[1] + ' ' + Math.round(x[0] * 100) + '%').join(',') + ')';
  }
  const METRICS = [
    { id: 'velocity', label: 'Velocity', unit: 'm/s', kind: 'seq' },
    { id: 'accel', label: 'Acceleration', unit: 'm/s\u00b2', kind: 'div' },
    { id: 'angvel', label: 'Angular velocity', unit: '\u00b0/s', kind: 'div' },
    { id: 'curvature', label: 'Curvature', unit: '1/m', kind: 'seq' },
  ];

  // ---- safety analysis: flag tight curvature + sharp velocity dips ----
  function analyze(pts, prof, m, robot) {
    const n = pts.length; const out = [];
    if (n < 3) return out;
    const totalS = pts[n - 1].s || 1;
    const vCap = (robot && robot.maxSpeed) || 5;
    // tight curvature: radius below ~0.7 m is hard on a drivetrain
    let cuf = -1, cuMax = 0, cuAt = 0;
    for (let i = 1; i < n - 1; i++) {
      const rad = pts[i].curv > 1e-4 ? 1 / pts[i].curv : Infinity;
      if (rad < 0.7) { const sev = rad < 0.4 ? 1 : 0.6; if (pts[i].curv > cuMax) { cuMax = pts[i].curv; cuAt = i; } if (cuf < 0) cuf = i; }
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

  // Path type belongs to the SEGMENT between two waypoints. The list stays honest:
  // only true geometry types live here, grouped Basic / Spline. Snapping, heading-hold,
  // approach and auto-smooth are tooling/constraint behaviours and live elsewhere.
  const SEGTYPES = [
    { id: 'line', label: 'Straight', abbr: 'LIN', group: 'Basic', hint: 'Straight line \u2014 control handles ignored.' },
    { id: 'arc', label: 'Arc', abbr: 'ARC', group: 'Basic', hint: 'Constant-radius turn, tangent to the out-handle.' },
    { id: 'bezier', label: 'B\u00e9zier', abbr: 'BEZ', group: 'Spline', hint: 'Hand-shaped spline driven by the control handles.' },
    { id: 'clothoid', label: 'Clothoid', abbr: 'CLO', group: 'Spline', hint: 'Euler spiral \u2014 curvature ramps smoothly (swerve-friendly).' },
  ];

  // ---- constraint-range anchoring -------------------------------------------
  // A range can be anchored three ways (the memo's request). We resolve each to
  // concrete arclength fractions [f0,f1] against the CURRENT path so the profile
  // engine + overlays stay simple, while the stored anchor keeps the range
  // attached the way the user intends as the path is edited.
  //   param : fixed percent of the path        {f0,f1}
  //   dist  : fixed metres of travel           {d0,d1}
  //   wp    : pinned to a waypoint span        {w0,w1}
  function waypointFracs(doc, smp) {
    const pts = smp.pts; const total = smp.length || 1; const n = doc.waypoints.length;
    if (!pts.length) return doc.waypoints.map(() => 0);
    const perSeg = (pts.length - 1) / Math.max(1, n - 1);
    return doc.waypoints.map((_, k) => { const i = Math.min(pts.length - 1, Math.round(k * perSeg)); return pts[i].s / total; });
  }
  function effectiveRanges(doc, smp) {
    const ranges = doc.ranges || []; const total = smp.length || 1;
    const wf = ranges.some((r) => r.anchor === 'wp') ? waypointFracs(doc, smp) : null;
    return ranges.map((r) => {
      let f0 = r.f0, f1 = r.f1;
      if (r.anchor === 'dist') { f0 = (r.d0 != null ? r.d0 : (r.f0 || 0) * total) / total; f1 = (r.d1 != null ? r.d1 : (r.f1 || 0) * total) / total; }
      else if (r.anchor === 'wp' && wf) { const lo = Math.max(0, Math.min(wf.length - 1, r.w0 != null ? r.w0 : 0)); const hi = Math.max(0, Math.min(wf.length - 1, r.w1 != null ? r.w1 : wf.length - 1)); f0 = wf[lo]; f1 = wf[hi]; }
      f0 = Math.max(0, Math.min(1, f0 || 0)); f1 = Math.max(0, Math.min(1, f1 || 0));
      return { f0, f1, maxVel: r.maxVel, maxAccel: r.maxAccel, maxDecel: r.maxDecel, maxAngVel: r.maxAngVel, maxAngAccel: r.maxAngAccel, anchor: r.anchor || 'param', name: r.name };
    });
  }

  // ---- one-call derivation: everything the field + panels need for a path ----
  function derivePath(doc, robot, perSeg) {
    perSeg = perSeg || 56;
    const smp = sample(doc.waypoints, perSeg);
    const pts = smp.pts;
    const nWp = doc.waypoints.length;
    const lastI = Math.max(0, pts.length - 1);
    const wpIdx = doc.waypoints.map((_, k) => Math.min(lastI, k * perSeg));
    const total = smp.length || 1;
    const wpFrac = wpIdx.map((i) => (pts.length ? pts[i].s / total : 0));
    const stopIdx = [];
    doc.waypoints.forEach((w, k) => { if (w.stop) stopIdx.push(wpIdx[k]); });
    const cap = (robot && robot.maxSpeed) || doc.constraints.maxVel;
    const vmax = Math.min(doc.constraints.maxVel, cap);
    const sv = doc.waypoints[0] && doc.waypoints[0].stop ? 0 : doc.startVel;
    const gv = doc.waypoints[nWp - 1] && doc.waypoints[nWp - 1].stop ? 0 : doc.goalVel;
    const effRanges = effectiveRanges(doc, smp);
    // heading-generation mode (memo §3/§5): tank always follows tangent; swerve uses the path mode
    const headingMode = (robot && robot.drive === 'tank') ? 'tangent' : (doc.headingMode || 'targets');
    const mode = headingMode === 'tangent' ? 'tank' : 'swerve';
    const entries = [];
    if (headingMode !== 'tangent') {
      doc.waypoints.forEach((w, k) => { const isEnd = k === 0 || k === nWp - 1; if (isEnd || w.thetaOn) entries.push({ f: wpFrac[k], rad: (w.theta || 0) * D2R }); });
      if (headingMode === 'targets') (doc.targets || []).forEach((t) => entries.push({ f: t.f, rad: t.deg * D2R }));
    }
    const anchors = buildAnchors(entries);
    const head = pts.map((p) => { const f = total > 1e-6 ? p.s / total : 0; return mode === 'tank' ? p.heading : headingAt(f, anchors); });
    const dwell = [];
    doc.waypoints.forEach((w, k) => { if (w.stop && w.wait > 0) dwell.push({ idx: wpIdx[k], wait: w.wait }); });
    const prof = profile(pts, doc.constraints, sv, gv, { stopIdx, vmax, ranges: effRanges, heading: head, dwell });
    const mtr = metrics(pts, prof, anchors, mode);
    const warnings = analyze(pts, prof, mtr, robot || {});
    // rotational diagnostics: flag contiguous rotation-limited stretches (memo §16)
    if (prof.rotLimited) {
      const rl = prof.rotLimited;
      const pushRun = (a, b) => { const mid = Math.floor((a + b) / 2); warnings.push({ f: pts[mid].s / total, kind: 'rot', sev: 'med', text: 'Rotation-limited \u00b7 heading can\u2019t keep up at speed' }); };
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
        : wn.kind === 'rot'
        ? [{ id: 'cap', label: 'Cap speed on this stretch' }, { id: 'angvel', label: 'Raise max angular velocity' }]
        : [{ id: 'cap', label: 'Lower the speed cap around here' }, { id: 'handles', label: 'Lengthen handles to ease the curve' }, { id: 'insert', label: 'Insert a waypoint here' }];
    });
    return { sample: smp, prof, anchors, metrics: mtr, warnings, wpFrac, wpIdx, mode, effRanges, headingMode, rev: !!doc.driveBackward };
  }

  window.PM = { bez, bezD, sample, profile, poseAtTime, headingAt, metrics, analyze, metricColor, metricGradient, METRICS, SEGTYPES, buildAnchors, pointAtFraction, nearestFraction, autoHandles, angWrap, angLerp, D2R, R2D, lerp, derivePath, effectiveRanges, waypointFracs };
})();
