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
          if (!stopped.has(interval) && !translationInterval(interval) && !translationInterval(interval + 1)) changed = capInterval(interval, interval + 1, interval - 1, interval + 1) || changed;
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

  // heading anchors -> continuous heading along arclength fraction f in [0,1]
  // anchors: [{f, rad}] must include f=0 and f=1, sorted
  function headingAt(f, anchors) {
    if (!anchors.length) return 0;
    if (f <= anchors[0].f) return anchors[0].rad;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (f >= a.f && f <= b.f) {
        const tt = (b.f - a.f) < 1e-6 ? 0 : (f - a.f) / (b.f - a.f);
        // smoothstep for nicer rotation
        const ss = tt * tt * (3 - 2 * tt);
        return angLerp(a.rad, b.rad, ss);
      }
    }
    return anchors[anchors.length - 1].rad;
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
          f: 1,
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

  // build heading anchors from a flat list of {f, rad} entries (waypoint thetas + rotation targets)
  // ensures coverage of f=0 and f=1 so heading is defined across the whole path
  function buildAnchors(entries) {
    const arr = (entries || [])
      .filter(e => e && isFinite(e.f) && isFinite(e.rad))
      .map(e => ({ f: Math.max(0, Math.min(1, e.f)), rad: e.rad }))
      .sort((a, b) => a.f - b.f);
    if (!arr.length) return [{ f: 0, rad: 0 }, { f: 1, rad: 0 }];
    if (arr[0].f > 1e-6) arr.unshift({ f: 0, rad: arr[0].rad });
    if (arr[arr.length - 1].f < 1 - 1e-6) arr.push({ f: 1, rad: arr[arr.length - 1].rad });
    return arr;
  }

  // point + fraction lookup by arclength fraction f (for placing markers/targets)
  function pointAtFraction(f, pts) {
    const n = pts.length; if (!n) return { x: 0, y: 0, heading: 0 };
    const target = f * pts[n - 1].s;
    let lo = 1, hi = n - 1;
    if (target <= 0) return { ...pts[0] };
    if (target >= pts[n - 1].s) return { ...pts[n - 1] };
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].s < target) lo = mid + 1; else hi = mid; }
    const a = pts[lo - 1], b = pts[lo];
    const u = (target - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), heading: angLerp(a.heading, b.heading, u) };
  }

  // nearest fraction on path to a world point (for placing markers by click)
  function nearestFraction(wx, wy, pts) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - wx, dy = pts[i].y - wy; const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return pts.length > 1 ? pts[best].s / pts[pts.length - 1].s : 0;
  }

  // Return distinct ordered visits near a field point. Unlike nearestFraction,
  // this projects onto polyline edges and keeps spatially coincident passes
  // separate when they occur at different distances along the path.
  function nearestVisits(wx, wy, pts, options) {
    if (!pts || pts.length < 2) return [];
    const opts = options || {}, total = pts[pts.length - 1].s || 0;
    const projected = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
      const u = length2 > 1e-12 ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / length2)) : 0;
      const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u), distance = Math.hypot(wx - x, wy - y);
      const sameSegment = Number.isInteger(a.seg) && a.seg === b.seg;
      const seg = sameSegment ? a.seg : (u < 0.5 && Number.isInteger(a.seg) ? a.seg : (Number.isInteger(b.seg) ? b.seg : 0));
      const aT = sameSegment && Number.isFinite(a.t) ? a.t : 0;
      const bT = sameSegment && Number.isFinite(b.t) ? b.t : 1;
      const s = lerp(Number.isFinite(a.s) ? a.s : 0, Number.isFinite(b.s) ? b.s : total, u);
      projected.push({ x, y, s, f: total > 1e-9 ? s / total : 0, seg, t: lerp(aT, bT, u), heading: angLerp(a.heading || 0, b.heading || 0, u), distance, edge: i - 1 });
    }
    const minimum = projected.reduce((best, candidate) => Math.min(best, candidate.distance), Infinity);
    const tolerance = Number.isFinite(opts.tolerance) ? Math.max(0, opts.tolerance) : minimum + 1e-9;
    const nearby = projected.filter((candidate) => candidate.distance <= Math.max(tolerance, minimum + 1e-9)).sort((a, b) => a.s - b.s);
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

  // auto control handles for a fresh waypoint (smooth Catmull-Rom-ish)
  function autoHandles(waypoints, i) {
    const w = waypoints[i];
    const prev = waypoints[i - 1] || w, next = waypoints[i + 1] || w;
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const handle = Math.max(0.6, len * 0.28);
    return {
      prevC: { x: w.x - dx * handle, y: w.y - dy * handle },
      nextC: { x: w.x + dx * handle, y: w.y + dy * handle },
    };
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

  // ---- colour scales for the metric overlays ----
  function hex2rgb(hx) { return [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)]; }
  const RAMPS_M = {
    velocity:  [[0, '#3f6fd0'], [0.4, '#2fa36b'], [0.7, '#d28f37'], [1, '#cf4f4a']],
    accel:     [[0, '#3f6fd0'], [0.5, '#4d535e'], [1, '#cf4f4a']],
    angvel:    [[0, '#343d47'], [0.5, '#2f8fa6'], [1, '#5fcfe6']],
    curvature: [[0, '#39342b'], [0.5, '#a87c30'], [1, '#edbf5c']],
  };
  function metricColor(mode, tt) {
    const s = RAMPS_M[mode] || RAMPS_M.velocity;
    let t = Math.max(0, Math.min(1, tt));
    for (let i = 0; i < s.length - 1; i++) {
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

  // ---- path checks ----------------------------------------------------------
  // Only measured constraint violations are issues. Expected slowdowns are
  // neutral notes so the UI never calls normal planner behavior a failure.
  function analyze(pts, prof, m, robot, context) {
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

    if (cfg.plannerId === 'labviewClothoid' && cfg.minTurnRadiusM > 0 && curvaturePeak > 1e-6) {
      const actualRadius = 1 / curvaturePeak;
      if (actualRadius < cfg.minTurnRadiusM * 0.975) {
        checks.push({ f: at(curvatureAt), kind: 'geometry', level: 'warning', text: 'Corner spacing cannot maintain the ' + cfg.minTurnRadiusM.toFixed(2) + ' m minimum radius' });
      }
    }

    if (curvaturePeak > 1e-6 && constraints.maxVel > 0 && constraints.maxAccel > 0) {
      const curveLimit = Math.sqrt(constraints.maxAccel / curvaturePeak);
      if (curveLimit < constraints.maxVel * 0.7) {
        const planned = Math.min(curveLimit, m.v[curvatureAt] || curveLimit);
        checks.push({ f: at(curvatureAt), kind: 'performance', level: 'note', text: 'Turn limits speed to ' + planned.toFixed(1) + ' m/s' });
      }
    }
    return checks;
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
  // A range can be anchored three ways. We resolve each to
  // concrete arclength fractions [f0,f1] against the CURRENT path so the profile
  // engine + overlays stay simple, while the stored anchor keeps the range
  // attached the way the user intends as the path is edited.
  //   param : fixed percent of the path        {f0,f1}
  //   dist  : legacy fixed metres of travel    {d0,d1}
  //   wp    : local positions within segments  {w0,t0,w1,t1}; omitted t values
  //           preserve legacy whole-waypoint spans
  function waypointFracs(doc, smp) {
    const pts = smp.pts; const total = smp.length || 1; const n = doc.waypoints.length;
    if (!pts.length) return doc.waypoints.map(() => 0);
    if (Array.isArray(smp.wpIdx) && smp.wpIdx.length === n) return smp.wpIdx.map((index) => pts[Math.max(0, Math.min(pts.length - 1, index))].s / total);
    const perSeg = (pts.length - 1) / Math.max(1, n - 1);
    return doc.waypoints.map((_, k) => { const i = Math.min(pts.length - 1, Math.round(k * perSeg)); return pts[i].s / total; });
  }
  function resolvedHeadingTransition(waypoint) {
    const value = (waypoint && waypoint.headingTransition) || {};
    return { placement: value.placement || 'after', rotationPriority: value.rotationPriority || 'heading', distanceM: value.distanceM != null ? value.distanceM : 0.75 };
  }
  function headingTransitionWindows(waypoints, modes, breaks, wpFrac, totalDistance) {
    const total = Math.max(totalDistance || 0, 1e-9), windows = [];
    for (let segment = 1; segment < modes.length; segment++) {
      if (modes[segment] === modes[segment - 1] || breaks[segment]) continue;
      const policy = resolvedHeadingTransition(waypoints[segment]);
      const boundary = Math.max(0, Math.min(1, wpFrac[segment] != null ? wpFrac[segment] : 0));
      const beforeShare = policy.placement === 'before' ? 1 : policy.placement === 'split' ? 0.5 : 0;
      const previousValue = wpFrac[segment - 1] != null ? wpFrac[segment - 1] : boundary;
      const nextValue = wpFrac[segment + 1] != null ? wpFrac[segment + 1] : boundary;
      const previousLength = Math.max(0, boundary - Math.max(0, Math.min(1, previousValue)));
      const nextLength = Math.max(0, Math.max(0, Math.min(1, nextValue)) - boundary);
      const before = Math.min(previousLength, policy.distanceM * beforeShare / total);
      const after = Math.min(nextLength, policy.distanceM * (1 - beforeShare) / total);
      windows.push({ ...policy, waypointIndex: segment, start: boundary - before, end: boundary + after });
    }
    return windows;
  }
  function headingTransitionGoals(modes, breaks, wpIdx, pts, anchorsByLaw) {
    const totalDistance = pts.length ? pts[pts.length - 1].s : 0, goals = [];
    for (let segment = 1; segment < modes.length; segment++) {
      const law = modes[segment];
      if ((law !== 'manual' && law !== 'targets') || modes[segment - 1] === law || breaks[segment]) continue;
      let spanEndSegment = segment;
      while (spanEndSegment + 1 < modes.length && modes[spanEndSegment + 1] === law && !breaks[spanEndSegment + 1]) spanEndSegment++;
      const boundaryIndex = Math.max(0, Math.min(pts.length - 1, wpIdx[segment]));
      const spanEndIndex = Math.max(boundaryIndex, Math.min(pts.length - 1, wpIdx[spanEndSegment + 1]));
      const boundaryDistance = pts[boundaryIndex].s, spanEndDistance = pts[spanEndIndex].s;
      const anchor = anchorsByLaw[law].find((candidate) => {
        const distance = Math.max(0, Math.min(1, candidate.f)) * totalDistance;
        return distance >= boundaryDistance - 1e-9 && distance <= spanEndDistance + 1e-9;
      });
      if (anchor) goals.push({ segmentIndex: segment, distanceM: Math.max(boundaryDistance, Math.max(0, Math.min(1, anchor.f)) * totalDistance), heading: anchor.rad, spanEndIndex });
    }
    return goals;
  }
  function smoothHeadingTransitions(raw, modes, breaks, wpIdx, pts, waypoints, transitionGoals) {
    if (!raw.length) return [];
    transitionGoals = transitionGoals || [];
    const unwrappedRaw = [raw[0]];
    for (let i = 1; i < raw.length; i++) unwrappedRaw.push(unwrappedRaw[i - 1] + angWrap(raw[i] - unwrappedRaw[i - 1]));
    const out = unwrappedRaw.slice();
    const protectedAnchorIndices = new Set();
    for (let segment = 1; segment < modes.length; segment++) {
      if (modes[segment] === modes[segment - 1] || breaks[segment]) continue;
      const boundary = Math.max(1, Math.min(out.length - 1, wpIdx[segment]));
      const previousBoundary = Math.max(0, Math.min(boundary - 1, wpIdx[segment - 1]));
      const nextBoundary = Math.max(boundary, Math.min(out.length - 1, wpIdx[segment + 1]));
      let outgoingStart = Math.min(boundary + 1, nextBoundary);
      while (outgoingStart < nextBoundary && pts[outgoingStart].s - pts[boundary].s <= 1e-9) outgoingStart++;
      const policy = resolvedHeadingTransition(waypoints[segment]);
      let protectedBefore = -1;
      protectedAnchorIndices.forEach((index) => { if (index <= boundary) protectedBefore = Math.max(protectedBefore, index); });
      const boundaryProtected = protectedBefore === boundary;
      const authoredBeforeShare = policy.placement === 'before' ? 1 : policy.placement === 'split' ? 0.5 : 0;
      const beforeShare = boundaryProtected ? 0 : authoredBeforeShare;
      const incoming = boundaryProtected ? out[boundary] : out[boundary - 1];
      const transitionGoal = transitionGoals.find((goal) => goal.segmentIndex === segment);
      if (transitionGoal) {
        const boundaryDistance = pts[boundary].s;
        const beforeDistance = Math.min(policy.distanceM * beforeShare, Math.max(0, boundaryDistance - pts[previousBoundary].s));
        const goalAtBoundary = transitionGoal.distanceM <= boundaryDistance + 1e-9;
        const afterDistance = Math.min(policy.distanceM * (1 - beforeShare), Math.max(0, (goalAtBoundary ? pts[transitionGoal.spanEndIndex].s : transitionGoal.distanceM) - boundaryDistance));
        const requestedStart = boundaryDistance - beforeDistance;
        const requestedEnd = goalAtBoundary ? boundaryDistance + afterDistance : Math.min(transitionGoal.distanceM, boundaryDistance + afterDistance);
        let startIndex = previousBoundary;
        while (startIndex < boundary && pts[startIndex].s < requestedStart - 1e-9) startIndex++;
        if (protectedBefore >= startIndex && protectedBefore < boundary) startIndex = protectedBefore + 1;
        let anchorIndex = boundary;
        while (anchorIndex < transitionGoal.spanEndIndex && pts[anchorIndex].s < transitionGoal.distanceM - 1e-9) anchorIndex++;
        let endIndex = startIndex;
        while (endIndex < transitionGoal.spanEndIndex && pts[endIndex].s < requestedEnd - 1e-9) endIndex++;
        const goalIndex = goalAtBoundary ? endIndex : anchorIndex;
        const startHeading = startIndex < boundary ? out[startIndex] : incoming;
        const goalHeading = startHeading + angWrap(transitionGoal.heading - startHeading);
        const startDistance = pts[startIndex].s, endDistance = pts[endIndex].s;
        for (let i = startIndex; i <= goalIndex; i++) {
          const t = endDistance > startDistance + 1e-9 ? Math.max(0, Math.min(1, (pts[i].s - startDistance) / (endDistance - startDistance))) : 1;
          const smooth = t * t * t * (t * (t * 6 - 15) + 10);
          out[i] = startHeading + (goalHeading - startHeading) * smooth;
        }
        if (goalIndex < transitionGoal.spanEndIndex) {
          const nextIndex = goalIndex + 1;
          const branchOffset = goalHeading + angWrap(raw[nextIndex] - goalHeading) - unwrappedRaw[nextIndex];
          for (let i = nextIndex; i <= transitionGoal.spanEndIndex; i++) out[i] = unwrappedRaw[i] + branchOffset;
        }
        protectedAnchorIndices.add(goalIndex);
        continue;
      }
      const outgoing = incoming + angWrap(raw[outgoingStart] - incoming), delta = outgoing - incoming;
      const beforeDistance = Math.min(policy.distanceM * beforeShare, Math.max(0, pts[boundary].s - pts[previousBoundary].s));
      if (beforeDistance > 1e-9) {
        const startDistance = pts[boundary].s - beforeDistance;
        for (let i = previousBoundary; i < boundary; i++) {
          if (pts[i].s < startDistance - 1e-9) continue;
          if (i <= protectedBefore) continue;
          const t = Math.max(0, Math.min(1, (pts[i].s - startDistance) / beforeDistance));
          const smooth = t * t * t * (t * (t * 6 - 15) + 10);
          out[i] += delta * beforeShare * smooth;
        }
      }
      const boundaryHeading = incoming + delta * beforeShare;
      const afterDistance = Math.min(policy.distanceM * (1 - beforeShare), Math.max(0, pts[nextBoundary].s - pts[boundary].s));
      let previous = boundaryHeading;
      const afterStartIndex = boundaryProtected ? boundary + 1 : boundary;
      for (let i = afterStartIndex; i <= nextBoundary; i++) {
        const base = previous + angWrap(raw[i === boundary ? outgoingStart : i] - previous);
        const t = afterDistance > 1e-9 ? Math.max(0, Math.min(1, (pts[i].s - pts[boundary].s) / afterDistance)) : 1;
        const smooth = t * t * t * (t * (t * 6 - 15) + 10);
        out[i] = base + (boundaryHeading - outgoing) * (1 - smooth);
        previous = out[i];
      }
    }
    return out;
  }
  function effectiveRanges(doc, smp) {
    const ranges = doc.ranges || []; const total = smp.length || 1;
    const wf = ranges.some((r) => r.anchor === 'wp') ? waypointFracs(doc, smp) : null;
    return ranges.map((r) => {
      let f0 = r.f0, f1 = r.f1;
      if (r.anchor === 'dist') { f0 = (r.d0 != null ? r.d0 : (r.f0 || 0) * total) / total; f1 = (r.d1 != null ? r.d1 : (r.f1 || 0) * total) / total; }
      else if (r.anchor === 'wp' && wf) {
        const localFraction = (waypoint, local, fallback) => {
          if (local == null) return wf[Math.max(0, Math.min(wf.length - 1, waypoint != null ? waypoint : fallback))];
          const segment = Math.max(0, Math.min(wf.length - 2, Math.round(waypoint != null ? waypoint : 0)));
          const t = Math.max(0, Math.min(1, local));
          return wf[segment] + (wf[segment + 1] - wf[segment]) * t;
        };
        f0 = localFraction(r.w0, r.t0, 0); f1 = localFraction(r.w1, r.t1, wf.length - 1);
      }
      f0 = Math.max(0, Math.min(1, f0 || 0)); f1 = Math.max(0, Math.min(1, f1 || 0));
      return { f0, f1, maxVel: r.maxVel, maxAccel: r.maxAccel, maxDecel: r.maxDecel, maxAngVel: r.maxAngVel, maxAngAccel: r.maxAngAccel, rotationPriority: r.rotationPriority, anchor: r.anchor || 'param', name: r.name };
    });
  }

  function headingWithTranslationPriority(doc, robot, pts, prof, desired, ranges, transitions) {
    transitions = transitions || [];
    if (!robot || robot.drive === 'tank' || (!ranges.some((range) => range.rotationPriority === 'translation') && !transitions.some((transition) => transition.rotationPriority === 'translation')) || desired.length < 2) return desired;
    const activeAt = (f) => ranges.filter((range) => f >= Math.min(range.f0, range.f1) - 1e-9 && f <= Math.max(range.f0, range.f1) + 1e-9);
    const translationForInterval = (before, after) => {
      const start = Math.min(before, after), end = Math.max(before, after);
      const overlaps = (lo, hi) => Math.min(end, hi) - Math.max(start, lo) >= -1e-9;
      const active = ranges.filter((range) => overlaps(Math.min(range.f0, range.f1), Math.max(range.f0, range.f1)));
      const activeTransitions = transitions.filter((transition) => overlaps(transition.start, transition.end));
      return active.length + activeTransitions.length > 0
        && active.every((range) => range.rotationPriority === 'translation')
        && activeTransitions.every((transition) => transition.rotationPriority === 'translation');
    };
    const out = desired.slice();
    let following = false, actual = desired[0], omega = 0;
    const total = pts[pts.length - 1].s || 1;
    for (let i = 1; i < desired.length; i++) {
      const f = pts[i].s / total, previousF = pts[i - 1].s / total;
      if (translationForInterval(previousF, f)) following = true;
      const dt = prof.t[i] - prof.t[i - 1];
      if (!following || dt <= 1e-9) { actual = desired[i]; omega = dt > 1e-9 ? angWrap(desired[i] - desired[i - 1]) / dt : omega; out[i] = actual; continue; }
      const active = activeAt(f).concat(activeAt(previousF));
      let maxOmega = (doc.constraints.maxAngVel || 0) * D2R;
      let maxAccel = (doc.constraints.maxAngAccel || 0) * D2R;
      let maxDecel = (doc.constraints.maxAngDecel || doc.constraints.maxAngAccel || 0) * D2R;
      active.forEach((range) => {
        maxOmega = Math.min(maxOmega, range.maxAngVel * D2R);
        maxAccel = Math.min(maxAccel, range.maxAngAccel * D2R);
        maxDecel = Math.min(maxDecel, range.maxAngAccel * D2R);
      });
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
    let period = doc.labview && doc.labview.samplePeriodS >= 0.001 ? doc.labview.samplePeriodS : Infinity;
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

  function featureFraction(feature, smp) {
    const total = smp.length || 1;
    const raw = feature && feature.anchor === 'dist'
      ? (feature.d != null ? feature.d : (feature.f || 0) * total) / total
      : (feature && feature.f) || 0;
    return Math.max(0, Math.min(1, raw));
  }

  function remapWaypointRange(range, oldToNew, removedIndex, newCount) {
    if (!range || range.anchor !== 'wp') return range;
    const next = { ...range };
    const last = Math.max(0, newCount - 1);
    if (range.t0 != null || range.t1 != null) {
      const remapLocal = (segment, local) => {
        const authored = Number.isInteger(segment) ? segment : 0;
        const oldSegment = Math.max(0, Math.min(oldToNew.length - 2, authored));
        const oldLocal = Math.max(0, Math.min(1, local != null ? local : (authored >= oldToNew.length - 1 ? 1 : 0)));
        const a = oldToNew[oldSegment], b = oldToNew[oldSegment + 1];
        if (!Number.isInteger(a) || !Number.isInteger(b) || newCount < 2) {
          const fallback = Number.isInteger(a) ? a : Math.max(0, Math.min(last, oldSegment));
          return { segment: Math.max(0, Math.min(Math.max(0, newCount - 2), fallback)), local: oldLocal };
        }
        const position = Math.max(0, Math.min(last, a + (b - a) * oldLocal));
        const mappedSegment = Math.min(Math.max(0, newCount - 2), Math.floor(position));
        return { segment: mappedSegment, local: position >= last ? 1 : position - mappedSegment };
      };
      let start = remapLocal(range.w0, range.t0), end = remapLocal(range.w1, range.t1);
      if (start.segment + start.local > end.segment + end.local) { const swap = start; start = end; end = swap; }
      next.w0 = start.segment; next.t0 = start.local; next.w1 = end.segment; next.t1 = end.local;
      return next;
    }
    const oldStart = Number.isInteger(range.w0) ? range.w0 : 0;
    const oldEnd = Number.isInteger(range.w1) ? range.w1 : oldToNew.length - 1;
    const resolve = (value, start) => {
      const mapped = oldToNew[value];
      if (Number.isInteger(mapped)) return mapped;
      if (value === removedIndex) return start ? Math.min(value, last) : Math.max(0, value - 1);
      return Math.max(0, Math.min(last, value));
    };
    if (oldStart === removedIndex && oldEnd === removedIndex) {
      next.w0 = next.w1 = Math.min(removedIndex, last);
      return next;
    }
    const a = resolve(oldStart, true), b = resolve(oldEnd, false);
    next.w0 = Math.min(a, b); next.w1 = Math.max(a, b);
    return next;
  }

  // ---- one-call derivation: everything the field + panels need for a path ----
  function derivePath(doc, robot, perSeg, plannerId) {
    perSeg = perSeg || 56;
    const labview = doc.labview || {};
    const smp = plannerId === 'labviewBezier'
      ? labviewBezierSample(doc.waypoints, labview.bezierTangentMode || 'handles')
      : plannerId === 'labviewClothoid'
      ? labviewClothoidSample(doc.waypoints, labview.minTurnRadiusM || 0.5)
      : sample(doc.waypoints, perSeg);
    const pts = smp.pts;
    const nWp = doc.waypoints.length;
    const lastI = Math.max(0, pts.length - 1);
    const wpIdx = smp.wpIdx || doc.waypoints.map((_, k) => Math.min(lastI, k * perSeg));
    if (plannerId === 'labviewClothoid') {
      // Vertex-blend generation does not naturally emit authored segment IDs.
      // Rebuild them from the monotonic waypoint boundaries used by the field UI.
      for (let segment = 0; segment < wpIdx.length - 1; segment++) {
        const lo = Math.max(0, wpIdx[segment]), hi = Math.max(lo, wpIdx[segment + 1]);
        const startS = pts[lo] ? pts[lo].s : 0, endS = pts[hi] ? pts[hi].s : startS;
        for (let i = segment ? lo + 1 : lo; i <= hi && i < pts.length; i++) {
          pts[i].seg = segment;
          pts[i].t = endS > startS ? (pts[i].s - startS) / (endS - startS) : 0;
        }
      }
    }
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
      const boundaryHeadingActive = !isEnd
        && w.thetaOn
        && ((incomingMode === 'tangent' || incomingMode === 'lookAt') && (outgoingMode === 'manual' || outgoingMode === 'targets'))
        && (((w.headingTransition || {}).placement) || 'after') !== 'after';
      const entry = { f: wpFrac[k], rad: (w.theta || 0) * D2R };
      if (isEnd || (w.thetaOn && (incomingMode === 'manual' || (w.turnInPlace && outgoingMode === 'manual'))) || (boundaryHeadingActive && outgoingMode === 'manual')) manualEntries.push(entry);
      if (isEnd || (w.thetaOn && (incomingMode === 'targets' || (w.turnInPlace && outgoingMode === 'targets'))) || (boundaryHeadingActive && outgoingMode === 'targets')) targetEntries.push({ ...entry });
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
    const headingTransitions = headingTransitionWindows(doc.waypoints, segmentLaws, transitionBreaks, wpFrac, total);
    const transitionGoals = headingTransitionGoals(segmentLaws, transitionBreaks, wpIdx, pts, {
      manual: manualAnchors,
      targets: targetAnchors,
    });
    const head = smoothHeadingTransitions(rawHead, segmentLaws, transitionBreaks, wpIdx, pts, doc.waypoints, transitionGoals);
    const allTangent = doc.waypoints.slice(0, -1).every((_, segment) => effectiveHeadingMode(segment) === 'tangent');
    const mode = allTangent ? 'tank' : 'swerve';
    const dwell = [], turns = [], jiggles = [];
    doc.waypoints.forEach((w, k) => { if (w.stop && w.wait > 0) dwell.push({ idx: wpIdx[k], wait: w.wait }); });
    const compatibilityPlanner = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
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
    const prof = profile(pts, doc.constraints, sv, gv, { stopIdx, vmax, ranges: effRanges, headingTransitions, heading: head, dwell, turns, jiggles, freeSpeed: cap, motorMaxSpeed: compatibilityPlanner ? cap : 0 });
    const trackedHead = headingWithTranslationPriority(doc, robot, pts, prof, head, effRanges, headingTransitions);
    appendTerminalHeadingCatchup(doc, prof, trackedHead, head, effRanges);
    const anchors = mode === 'tank' ? [] : buildAnchors(pts.map((p, i) => ({ f: total > 1e-6 ? p.s / total : 0, rad: trackedHead[i] })));
    const mtr = metrics(pts, prof, anchors, mode);
    const checks = analyze(pts, prof, mtr, robot || {}, {
      constraints: doc.constraints,
      plannerId,
      minTurnRadiusM: labview.minTurnRadiusM || 0.5,
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
        checks.push({ f: pts[mid].s / total, kind: 'performance', level: 'note', text: 'Rotation limits speed through this stretch' });
      }
    }
    checks.forEach((check) => {
      let seg = 0;
      for (let i = 0; i < wpFrac.length - 1; i++) { if (check.f >= wpFrac[i] - 1e-4) seg = i; }
      check.seg = Math.max(0, Math.min(doc.waypoints.length - 2, seg));
    });
    return { sample: smp, prof, totalDistance: smp.length + (prof.actionDistance || 0), anchors, metrics: mtr, checks, wpFrac, wpIdx, mode, effRanges, headingMode, rev: !!doc.driveBackward };
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
  window.PM = { bez, bezD, splitBezier, nearestPointOnSegment, sample, profile, poseAtTime, headingAt, metrics, analyze, metricColor, metricGradient, METRICS, SEGTYPES, buildAnchors, pointAtFraction, nearestFraction, nearestVisits, autoHandles, angWrap, angLerp, D2R, R2D, lerp, derivePath, jigglePositions, effectiveRanges, featureFraction, remapWaypointRange, waypointFracs };
})();
