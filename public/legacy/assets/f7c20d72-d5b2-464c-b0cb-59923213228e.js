// Bordeaux — interactive field view (CAD-style). Needs React + window.PM. Exports window.FieldView
(function () {
  const { useRef, useState, useEffect, useMemo, useCallback } = React;
  const h = React.createElement;

  // ---- field calibration (image px) ----
  const IMG_W = 3901, IMG_H = 1583;
  const X0 = 397, X1 = 3502, Y0 = 97, Y1 = 1486; // playing surface in image px
  const FIELD_CX = (X0 + X1) / 2, FIELD_CY = (Y0 + Y1) / 2;
  const FIELD_W = 17.548, FIELD_H = 8.052;        // meters (WPILib 2025/26)
  const SX = (X1 - X0) / FIELD_W, SY = (Y1 - Y0) / FIELD_H;

  // muted semantic colors (reserved for meaning, low saturation)
  const C_START = '#4bbf86', C_END = '#d2655f', C_NODE = '#8b94a2', C_NEUTRAL = '#9aa3b0';

  const localFootprint = (robot) => robot.footprint && robot.footprint.kind === 'polygon' && Array.isArray(robot.footprint.verticesM)
    ? robot.footprint.verticesM
    : [{ x: -robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: -robot.w / 2 }, { x: robot.l / 2, y: robot.w / 2 }, { x: -robot.l / 2, y: robot.w / 2 }];
  const footprintPoints = (robot, scale) => localFootprint(robot).map((point) => `${point.x * SX * scale},${-point.y * SY * scale}`).join(' ');
  const forwardExtent = (robot) => Math.max(...localFootprint(robot).map((point) => point.x)) * SX;

  function FieldView(props) {
    const { doc, derived, insertionPreview, proposalPreviews, sel, tool, view, setView, alliance, showGrid, robot, drive, accent, metric, playTime, actions, onSelPos, routine, routinePose } = props;
    const showHandles = props.showHandles !== false;
    const svgRef = useRef(null);
    const [cw, setCw] = useState(1200);
    const [preview, setPreview] = useState(null);
    const [snap, setSnap] = useState(null);
    const [visitFocus, setVisitFocus] = useState(null);
    const visitFocusRef = useRef(null);
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const drag = useRef(null);
    const lastInspectPress = useRef({ key: null, at: 0 });
    const flip = alliance === 'red';
    const isTank = drive === 'tank';

    const tf = useCallback((p) => flip ? { x: FIELD_W - p.x, y: FIELD_H - p.y } : p, [flip]);
    const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });
    const wx = (x) => X0 + x * SX;
    const wy = (y) => Y1 - y * SY;
    const W2P = useCallback((p) => { const q = tf(p); return { x: wx(q.x), y: wy(q.y) }; }, [tf]);

    const clientToWorld = useCallback((cx, cy, bounded = true) => {
      const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };

    // report selected element's screen position for the floating inspector
    useEffect(() => {
      const svg = svgRef.current; if (!svg || !onSelPos) return;
      const pp = derived.sample.pts;
      let wpoint = null;
      if (sel.kind === 'wp' && doc.waypoints[sel.idx]) wpoint = doc.waypoints[sel.idx];
      else if (sel.kind === 'rt' && doc.targets[sel.idx]) wpoint = window.PM.pointAtFraction(doc.targets[sel.idx].f, pp);
      else if (sel.kind === 'em' && doc.markers[sel.idx]) wpoint = window.PM.pointAtFraction(doc.markers[sel.idx].f, pp);
      else if (sel.kind === 'cr' && doc.ranges && doc.ranges[sel.idx]) { const rg = doc.ranges[sel.idx]; wpoint = window.PM.pointAtFraction((rg.f0 + rg.f1) / 2, pp); }
      if (!wpoint) { onSelPos(null); return; }
      const ctm = svg.getScreenCTM(); if (!ctm) { onSelPos(null); return; }
      const ip = W2P(wpoint);
      const sp = svg.createSVGPoint(); sp.x = ip.x; sp.y = ip.y;
      const s = sp.matrixTransform(ctm);
      onSelPos({ x: s.x, y: s.y });
    }, [sel, doc, view, cw, flip, onSelPos, W2P, derived]);

    const upp = view.w / Math.max(1, cw);
    const P = (px) => px * upp;

    // ---- pointer handling ----
    const onDown = (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      const t = e.target;
      const role = t.getAttribute && t.getAttribute('data-role');
      try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
      if (routine) {
        if (role === 'rpath') { const id = t.getAttribute('data-idx'); if (actions.selectNode) actions.selectNode(id); drag.current = null; return; }
        drag.current = { role: 'bg', start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, moved: false, mid: e.button === 1 };
        return;
      }
      const world = clientToWorld(e.clientX, e.clientY);
      if (role === 'head') {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        actions.select('wp', idx);
        drag.current = { role: 'head', idx, moved: false };
        return;
      }
      if (role === 'seg') {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        if (e.altKey || tool === 'waypoint') drag.current = { role: 'bg', onPath: true, start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, world, moved: false, mid: false };
        else { actions.select('seg', idx); drag.current = null; }
        return;
      }
      if (role && role !== 'bg' && role !== 'ins') {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        if (role === 'wp' && e.shiftKey && idx > 0 && idx < doc.waypoints.length - 1 && actions.delWp) { actions.delWp(idx); drag.current = null; return; }
        drag.current = { role, idx, moved: false };
        if (role === 'ct') actions.select('wp', idx >> 1);
        else if (role === 'rs' || role === 're') actions.select('cr', idx);
        else if (role === 'wp' || role === 'rt' || role === 'em') actions.select(role, idx);
        return;
      }
      if (tool === 'range' && pts.length > 1) {
        const f0 = window.PM.nearestFraction(world.x, world.y, pts);
        drag.current = { role: 'newrange', f0, f1: f0, moved: false };
        setPreview({ f0, f1: f0 });
        return;
      }
      drag.current = { role: 'bg', onPath: role === 'ins', start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, world, moved: false, mid: e.button === 1 };
    };

    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const world = clientToWorld(e.clientX, e.clientY);
      if (d.role === 'bg') {
        const dx = e.clientX - d.start.cx, dy = e.clientY - d.start.cy;
        if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
        if (d.moved) setView({ x: d.vb0.x - dx * upp, y: d.vb0.y - dy * upp, w: d.vb0.w, h: d.vb0.h });
        return;
      }
      if (d.role === 'newrange') { d.f1 = window.PM.nearestFraction(world.x, world.y, pts); d.moved = true; setPreview({ f0: d.f0, f1: d.f1 }); return; }
      if (d.role === 'head') {
        const w = doc.waypoints[d.idx];
        if (w) {
          let deg = Math.atan2(world.y - w.y, world.x - w.x) * 180 / Math.PI;
          let label = null;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          else {
            const cands = [];
            const wi = derived.wpIdx ? derived.wpIdx[d.idx] : 0; const tp = pts[wi];
            if (tp) cands.push({ deg: tp.heading * 180 / Math.PI, label: 'Tangent' });
            const nx = doc.waypoints[d.idx + 1]; if (nx) cands.push({ deg: Math.atan2(nx.y - w.y, nx.x - w.x) * 180 / Math.PI, label: 'Face next' });
            const pv = doc.waypoints[d.idx - 1]; if (pv) cands.push({ deg: Math.atan2(pv.y - w.y, pv.x - w.x) * 180 / Math.PI, label: 'Face prev' });
            let best = null, bestD = 8;
            cands.forEach((cd) => { const dd = Math.abs(window.PM.angWrap((deg - cd.deg) * Math.PI / 180) * 180 / Math.PI); if (dd < bestD) { bestD = dd; best = cd; } });
            if (best) { deg = best.deg; label = best.label; } else deg = Math.round(deg);
          }
          setSnap(label ? { idx: d.idx, label } : null);
          actions.setWaypointHeading(d.idx, deg);
        }
        d.moved = true; return;
      }
      d.moved = true;
      const p = clampWorld(world);
      if (d.role === 'wp') actions.moveWaypoint(d.idx, p);
      else if (d.role === 'ct') actions.moveHandle(d.idx >> 1, d.idx & 1, p);
      else if (d.role === 'rt') actions.moveTargetTo(d.idx, world);
      else if (d.role === 'em') actions.moveMarkerTo(d.idx, world);
      else if (d.role === 'rs') actions.moveRangeHandle(d.idx, 0, window.PM.nearestFraction(world.x, world.y, pts));
      else if (d.role === 're') actions.moveRangeHandle(d.idx, 1, window.PM.nearestFraction(world.x, world.y, pts));
    };

    const onUp = (e) => {
      const d = drag.current; drag.current = null;
      setSnap(null);
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!d) return;
      if (d.role === 'newrange') {
        setPreview(null);
        const f0 = d.f0, f1 = d.f1;
        if (Math.abs(f1 - f0) >= 0.015) actions.addRange(f0, f1);
        return;
      }
      if (d.role === 'bg' && !d.moved && !d.mid) {
        if (tool === 'waypoint') actions.addWaypoint(d.world);
        else if (tool === 'rotation') actions.addTargetAt(d.world);
        else if (tool === 'marker') actions.addMarkerAt(d.world);
        else if (tool === 'select') { if (d.onPath) actions.addWaypoint(d.world); else actions.select(null, -1); }
      }
    };

    const onWheel = (e) => {
      e.preventDefault();
      const svg = svgRef.current; const ctm = svg.getScreenCTM();
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const u = pt.matrixTransform(ctm.inverse());
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      let nw = view.w * factor;
      nw = Math.max(IMG_W * 0.12, Math.min(IMG_W * 1.6, nw)); const nh = nw * (IMG_H / IMG_W);
      const k = nw / view.w;
      setView({ x: u.x - (u.x - view.x) * k, y: u.y - (u.y - view.y) * k, w: nw, h: nh });
    };

    const onDbl = (e) => {
      if (routine) return;
      const t = e.target; const role = t.getAttribute && t.getAttribute('data-role');
      if (role === 'seg') actions.addWaypoint(clientToWorld(e.clientX, e.clientY));
      else if (role === 'head') actions.select('wp', parseInt(t.getAttribute('data-idx'), 10));
    };
    const onCtx = (e) => {
      e.preventDefault();
      if (routine) return;
      const t = e.target; const role = t.getAttribute && t.getAttribute('data-role');
      if (role === 'head' && actions.headingMenu) actions.headingMenu(parseInt(t.getAttribute('data-idx'), 10), e.clientX, e.clientY);
    };

    const pts = derived.sample.pts;

    // ---------- STATIC LAYERS ----------
    const staticLayers = useMemo(() => {
      const els = [];
      const M = derived.metrics;
      const headingMode = derived.headingMode;
      const tangentMode = headingMode === 'tangent';
      const tanDeg = (i) => { const idx = derived.wpIdx ? derived.wpIdx[i] : 0; const p = pts[idx]; return p ? p.heading * 180 / Math.PI : 0; };
      const colAt = (i) => {
        if (metric === 'accel') return window.PM.metricColor('accel', 0.5 + 0.5 * (M.accel[i] / (M.aMax || 1)));
        if (metric === 'angvel') return window.PM.metricColor('angvel', 0.5 + 0.5 * (M.omega[i] / (M.wMax || 1)));
        if (metric === 'curvature') return window.PM.metricColor('curvature', M.curv[i] / (M.kMax || 1));
        return window.PM.metricColor('velocity', M.v[i] / (M.vMax || 1));
      };

      if (showGrid) {
        const g = [];
        for (let m = 0; m <= Math.round(FIELD_W); m++) { const x = X0 + m * SX; g.push(h('line', { key: 'gx' + m, x1: x, y1: Y0, x2: x, y2: Y1, stroke: '#ffffff', strokeOpacity: 0.045, strokeWidth: P(1) })); }
        for (let m = 0; m <= Math.round(FIELD_H); m++) { const y = Y1 - m * SY; g.push(h('line', { key: 'gy' + m, x1: X0, y1: y, x2: X1, y2: y, stroke: '#ffffff', strokeOpacity: 0.045, strokeWidth: P(1) })); }
        els.push(h('g', { key: 'grid' }, g));
      }

      // thin CAD centerline: subtle casing + metric-colored body + invisible insert hit-line
      if (pts.length > 1) {
        const totalS = derived.sample.length || 1;
        const ranges = derived.effRanges || doc.ranges || [];
        // constraint range bands (under the centerline)
        ranges.forEach((rg, ri) => {
          const lo = Math.min(rg.f0, rg.f1), hi = Math.max(rg.f0, rg.f1);
          const isSel = sel.kind === 'cr' && sel.idx === ri;
          let dd = ''; let started = false;
          for (let k = 0; k < pts.length; k++) { const f = pts[k].s / totalS; if (f >= lo && f <= hi) { const q = W2P(pts[k]); dd += (started ? ' L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); started = true; } }
          if (dd) els.push(h('path', { key: 'rb' + ri, d: dd, fill: 'none', stroke: isSel ? accent : '#caa23a', strokeOpacity: isSel ? 0.5 : 0.32, strokeWidth: P(12), strokeLinecap: 'round', strokeLinejoin: 'round', style: { pointerEvents: 'none' } }));
        });
        let dCase = `M ${W2P(pts[0]).x} ${W2P(pts[0]).y}`;
        for (let i = 1; i < pts.length; i++) { const q = W2P(pts[i]); dCase += ` L ${q.x} ${q.y}`; }
        els.push(h('path', { key: 'case', d: dCase, fill: 'none', stroke: '#05060a', strokeOpacity: 0.75, strokeWidth: P(5), strokeLinecap: 'round', strokeLinejoin: 'round' }));
        const segEls = [];
        const stride = Math.max(1, Math.floor(pts.length / 200));
        for (let i = 0; i + stride < pts.length; i += stride) {
          const a = W2P(pts[i]), b = W2P(pts[i + stride]);
          segEls.push(h('line', { key: 's' + i, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: colAt(i), strokeWidth: P(2.6), strokeLinecap: 'butt' }));
        }
        els.push(h('g', { key: 'pathbody' }, segEls));
        // selected-segment highlight (memo §3)
        if (sel.kind === 'seg' && derived.wpFrac && derived.wpFrac.length > sel.idx + 1) {
          const lo = derived.wpFrac[sel.idx], hi = derived.wpFrac[sel.idx + 1];
          let sd = '', st = false;
          for (let k = 0; k < pts.length; k++) { const f = pts[k].s / totalS; if (f >= lo - 1e-4 && f <= hi + 1e-4) { const q = W2P(pts[k]); sd += (st ? ' L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); st = true; } }
          if (sd) els.push(h('path', { key: 'segsel', d: sd, fill: 'none', stroke: accent, strokeWidth: P(5.5), strokeOpacity: 0.92, strokeLinecap: 'round', strokeLinejoin: 'round', style: { pointerEvents: 'none' } }));
        }
        // per-segment hit paths — click selects the segment; alt-click / waypoint-tool inserts (memo §3)
        if (derived.wpFrac) {
          for (let si = 0; si < doc.waypoints.length - 1; si++) {
            const lo = derived.wpFrac[si], hi = derived.wpFrac[si + 1];
            let sd = '', st = false;
            for (let k = 0; k < pts.length; k++) { const f = pts[k].s / totalS; if (f >= lo - 1e-4 && f <= hi + 1e-4) { const q = W2P(pts[k]); sd += (st ? ' L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); st = true; } }
            if (sd) els.push(h('path', { key: 'seghit' + si, d: sd, fill: 'none', stroke: 'transparent', strokeWidth: P(18), strokeLinecap: 'round', 'data-role': 'seg', 'data-idx': si, style: { cursor: tool === 'waypoint' ? 'copy' : 'pointer' } }));
          }
        }
        // range handles + velocity tag (above the path)
        ranges.forEach((rg, ri) => {
          const isSel = sel.kind === 'cr' && sel.idx === ri;
          const col = isSel ? accent : '#caa23a';
          [['f0', 'rs'], ['f1', 're']].forEach(([fk, role]) => {
            const pf = window.PM.pointAtFraction(rg[fk], pts); const c = W2P(pf);
            els.push(h('g', { key: role + ri, transform: `translate(${c.x} ${c.y})`, style: { cursor: 'ew-resize' } },
              h('circle', { r: P(7), fill: '#14161a', stroke: col, strokeWidth: P(2), 'data-role': role, 'data-idx': ri }),
              h('circle', { r: P(2.5), fill: col, 'data-role': role, 'data-idx': ri })));
          });
          const mid = window.PM.pointAtFraction((rg.f0 + rg.f1) / 2, pts); const mc = W2P(mid);
          els.push(h('text', { key: 'rl' + ri, x: mc.x, y: mc.y - P(15), fill: col, fontSize: P(13), fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, textAnchor: 'middle', style: { pointerEvents: 'none' } }, '\u2264' + rg.maxVel.toFixed(1) + ' m/s'));
        });
      }

      // precise heading helper (waypoints) — draggable when idx is supplied (memo §7)
      const headArrow = (cx, cy, deg, col, len, idx) => {
        const rot = flip ? deg + 180 : deg;
        const interactive = idx != null;
        return h('g', { transform: `translate(${cx} ${cy}) rotate(${-rot})`, style: interactive ? { cursor: 'grab' } : { pointerEvents: 'none' } },
          h('line', { x1: 0, y1: 0, x2: len, y2: 0, stroke: col, strokeWidth: P(1.8), strokeLinecap: 'round' }),
          h('path', { d: `M ${len} ${-P(3.8)} L ${len + P(7)} 0 L ${len} ${P(3.8)} Z`, fill: col }),
          interactive && h('line', { x1: P(5), y1: 0, x2: len + P(8), y2: 0, stroke: 'transparent', strokeWidth: P(15), strokeLinecap: 'round', 'data-role': 'head', 'data-idx': idx }),
          interactive && h('circle', { cx: len + P(2), cy: 0, r: P(8.5), fill: 'transparent', 'data-role': 'head', 'data-idx': idx }));
      };

      // facing comb: neutral, thin heading ticks along the trajectory
      if (pts.length > 1 && !isTank) {
        const totalLen = derived.sample.length || 1;
        const step = 0.78;
        const comb = [];
        for (let dl = step * 0.55; dl < totalLen - 0.04; dl += step) {
          const f = dl / totalLen;
          const pf = window.PM.pointAtFraction(f, pts);
          const rad = tangentMode ? pf.heading : window.PM.headingAt(f, derived.anchors);
          const c = W2P(pf);
          const rot = flip ? (rad * 180 / Math.PI) + 180 : (rad * 180 / Math.PI);
          comb.push(h('g', { key: 'cb' + dl.toFixed(2), transform: `translate(${c.x} ${c.y}) rotate(${-rot})` },
            h('line', { x1: 0, y1: 0, x2: P(12), y2: 0, stroke: '#aeb6c2', strokeWidth: P(1.1), strokeLinecap: 'round' }),
            h('path', { d: `M ${P(12)} ${-P(2.6)} L ${P(16.5)} 0 L ${P(12)} ${P(2.6)} Z`, fill: '#aeb6c2' })));
        }
        els.push(h('g', { key: 'comb', opacity: 0.32, style: { pointerEvents: 'none' } }, comb));
      }

      // ghost robot footprint (dashed outline) at a pose
      const ghost = (cx, cy, deg, col, key, op) => {
        const rot = flip ? deg + 180 : deg;
        const rw = robot.w * SX, rh = robot.l * SY;
        return h('g', { key, transform: `translate(${cx} ${cy}) rotate(${-rot})`, opacity: op, style: { pointerEvents: 'none' } },
          h('rect', { x: -rw / 2, y: -rh / 2, width: rw, height: rh, rx: P(2), fill: 'none', stroke: col, strokeWidth: P(1.6), strokeDasharray: `${P(7)} ${P(5)}` }));
      };
      const wps = doc.waypoints;
      const startHead = isTank && pts.length ? pts[0].heading * 180 / Math.PI : (wps[0] ? (wps[0].theta || 0) : 0);
      const endHead = isTank && pts.length ? pts[pts.length - 1].heading * 180 / Math.PI : (wps[wps.length - 1] ? (wps[wps.length - 1].theta || 0) : 0);
      if (wps[0]) { const c = W2P(wps[0]); els.push(ghost(c.x, c.y, startHead, C_START, 'gs', 0.28)); }
      if (wps[wps.length - 1]) { const c = W2P(wps[wps.length - 1]); els.push(ghost(c.x, c.y, endHead, C_END, 'ge', 0.28)); }

      // event markers — neutral diamond node + flag
      doc.markers.forEach((mk, i) => {
        const pf = window.PM.pointAtFraction(mk.f, pts); const c = W2P(pf);
        const isSel = sel.kind === 'em' && sel.idx === i;
        const col = isSel ? accent : C_NEUTRAL;
        els.push(h('g', { key: 'em' + i, transform: `translate(${c.x} ${c.y})`, style: { cursor: 'pointer' } },
          h('line', { x1: 0, y1: 0, x2: 0, y2: -P(22), stroke: col, strokeWidth: P(1.4) }),
          h('path', { d: `M 0 ${-P(22)} L ${P(11)} ${-P(17.5)} L 0 ${-P(13)} Z`, fill: col, 'data-role': 'em', 'data-idx': i }),
          h('rect', { x: -P(4), y: -P(4), width: P(8), height: P(8), transform: 'rotate(45)', fill: '#14161a', stroke: col, strokeWidth: P(1.6), 'data-role': 'em', 'data-idx': i })));
      });

      // rotation targets — ghost robot oriented at the target heading + heading vector
      if (!isTank && headingMode === 'targets') doc.targets.forEach((rtg, i) => {
        const pf = window.PM.pointAtFraction(rtg.f, pts); const c = W2P(pf);
        const isSel = sel.kind === 'rt' && sel.idx === i;
        const deg = flip ? rtg.deg + 180 : rtg.deg;
        const col = isSel ? accent : C_NEUTRAL;
        const rw = robot.w * SX, rh = robot.l * SY;
        els.push(h('g', { key: 'rt' + i, style: { cursor: 'pointer' } },
          h('g', { transform: `translate(${c.x} ${c.y}) rotate(${-deg})`, opacity: isSel ? 0.95 : 0.6 },
            h('rect', { x: -rw / 2, y: -rh / 2, width: rw, height: rh, rx: P(2), fill: isSel ? 'rgba(63,111,208,0.10)' : 'rgba(0,0,0,0.18)', stroke: col, strokeWidth: P(1.6), 'data-role': 'rt', 'data-idx': i }),
            h('line', { x1: 0, y1: 0, x2: rw / 2 + P(9), y2: 0, stroke: col, strokeWidth: P(2) }),
            h('path', { d: `M ${rw / 2 + P(6)} ${-P(5)} L ${rw / 2 + P(17)} 0 L ${rw / 2 + P(6)} ${P(5)} Z`, fill: col })),
          h('circle', { cx: c.x, cy: c.y, r: P(3), fill: col, 'data-role': 'rt', 'data-idx': i })));
      });

      // waypoints — square CAD nodes + heading + control handles
      doc.waypoints.forEach((w, i) => {
        const c = W2P(w);
        const isSel = sel.kind === 'wp' && sel.idx === i;
        const isStart = i === 0, isEnd = i === doc.waypoints.length - 1;
        const baseCol = isStart ? C_START : isEnd ? C_END : C_NODE;
        const col = isSel ? accent : baseCol;
        const group = [];
        if (!isTank && (tangentMode || isStart || isEnd || w.thetaOn || isSel)) {
          group.push(h('g', { key: 'th' }, headArrow(c.x, c.y, tangentMode ? tanDeg(i) : (w.theta || 0), col, P(26), i)));
        }
        if (isSel) {
          [['prevC', 0], ['nextC', 1]].forEach(([key, b]) => {
            if ((isStart && key === 'prevC') || (isEnd && key === 'nextC')) return;
            const cc = W2P(w[key]);
            group.push(h('line', { key: 'hl' + b, x1: c.x, y1: c.y, x2: cc.x, y2: cc.y, stroke: accent, strokeWidth: P(1.2), strokeOpacity: 0.65 }));
            group.push(h('circle', { key: 'hc' + b, cx: cc.x, cy: cc.y, r: P(5), fill: '#0c0d10', stroke: accent, strokeWidth: P(1.8), 'data-role': 'ct', 'data-idx': i * 2 + b, style: { cursor: 'grab' } }));
          });
          group.push(h('rect', { key: 'selring', x: c.x - P(11), y: c.y - P(11), width: P(22), height: P(22), rx: P(2), fill: 'none', stroke: accent, strokeWidth: P(1.4), strokeOpacity: 0.55 }));
        }
        const s = P(6.5);
        if (w.stop) group.push(h('rect', { key: 'stopo', x: c.x - s - P(3), y: c.y - s - P(3), width: (s + P(3)) * 2, height: (s + P(3)) * 2, rx: P(1.5), fill: 'none', stroke: '#d2655f', strokeWidth: P(1.4) }));
        group.push(h('rect', { key: 'node', x: c.x - s, y: c.y - s, width: s * 2, height: s * 2, rx: P(1.5), fill: '#14161a', stroke: col, strokeWidth: P(2), 'data-role': 'wp', 'data-idx': i, style: { cursor: 'grab' } }));
        els.push(h('g', { key: 'w' + i }, group));
      });

      // segment-type chips at each non-Bézier segment midpoint (legible hybrid paths)
      if (pts.length > 1 && derived.wpFrac) {
        const ABBR = { line: 'LIN', arc: 'ARC', clothoid: 'CLO' };
        for (let i = 0; i < doc.waypoints.length - 1; i++) {
          const st = doc.waypoints[i].segType;
          if (!ABBR[st]) continue;
          const fmid = ((derived.wpFrac[i] || 0) + (derived.wpFrac[i + 1] || 0)) / 2;
          const pf = window.PM.pointAtFraction(fmid, pts); const c = W2P(pf);
          const tw = P(30), th = P(15);
          els.push(h('g', { key: 'sc' + i, transform: `translate(${c.x} ${c.y + P(17)})`, style: { pointerEvents: 'none' } },
            h('rect', { x: -tw / 2, y: -th / 2, width: tw, height: th, rx: P(2.5), fill: 'rgba(14,16,20,0.9)', stroke: '#3a4250', strokeWidth: P(1) }),
            h('text', { x: 0, y: P(3.6), fill: '#aeb6c2', fontSize: P(9.5), fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, letterSpacing: P(0.5), textAnchor: 'middle' }, ABBR[st])));
        }
      }

      // safety warnings — curvature / velocity-spike badges
      if (derived.warnings && derived.warnings.length) {
        derived.warnings.forEach((wn, i) => {
          const pf = window.PM.pointAtFraction(wn.f, pts); const c = W2P(pf);
          const col = wn.sev === 'high' ? '#d2655f' : '#d9a441';
          els.push(h('g', { key: 'wn' + i, transform: `translate(${c.x} ${c.y - P(28)})`, style: { pointerEvents: 'none' } },
            h('path', { d: `M 0 ${-P(8)} L ${P(8)} ${P(6)} L ${-P(8)} ${P(6)} Z`, fill: 'rgba(14,16,20,0.92)', stroke: col, strokeWidth: P(1.4), strokeLinejoin: 'round' }),
            h('rect', { x: -P(0.8), y: -P(3.5), width: P(1.6), height: P(5.5), rx: P(0.8), fill: col }),
            h('circle', { cx: 0, cy: P(4), r: P(1), fill: col })));
        });
      }
      return els;
    }, [doc, derived, sel, showGrid, alliance, accent, metric, robot, drive, tool, view.w, cw]);

    // ---------- ROBOT (dynamic) ----------
    const robotEl = useMemo(() => {
      const pose = pts.length > 1 ? window.PM.poseAtTime(playTime, pts, derived.prof, derived.anchors, derived.mode, derived.rev)
        : (doc.waypoints[0] ? { x: doc.waypoints[0].x, y: doc.waypoints[0].y, heading: ((doc.waypoints[0].theta || 0) + (derived.rev ? 180 : 0)) * Math.PI / 180, speed: 0 } : null);
      if (!pose) return null;
      const c = W2P(pose);
      const degHead = pose.heading * 180 / Math.PI + (flip ? 180 : 0);
      const rw = robot.w * SX, rh = robot.l * SY;
      const bump = alliance === 'red' ? '#c75450' : '#4271c0';
      return h('g', { transform: `translate(${c.x} ${c.y}) rotate(${-degHead})`, style: { pointerEvents: 'none' } },
        h('rect', { x: -rw / 2, y: -rh / 2, width: rw, height: rh, rx: P(2.5), fill: 'rgba(14,16,20,0.82)', stroke: bump, strokeWidth: P(3) }),
        h('rect', { x: -rw / 2 + P(5), y: -rh / 2 + P(5), width: rw - P(10), height: rh - P(10), rx: P(1.5), fill: 'none', stroke: 'rgba(255,255,255,0.10)', strokeWidth: P(1) }),
        h('line', { x1: 0, y1: 0, x2: rw / 2 + P(3), y2: 0, stroke: '#e8ecf2', strokeWidth: P(2.5) }),
        h('path', { d: `M ${rw / 2 + P(1)} ${-P(6)} L ${rw / 2 + P(13)} 0 L ${rw / 2 + P(1)} ${P(6)} Z`, fill: '#e8ecf2' }));
    }, [playTime, pts, derived, drive, alliance, robot, view.w, cw, flip, doc.waypoints]);

    // ---------- ROUTINE OVERLAY (Autonomous Routine / Auto mode) ----------
    const routineLayers = useMemo(() => {
      if (!routine) return null;
      const els = [];
      const STYLE = {
        done:      { col: '#5b636e', w: 2.6, op: 0.5, dash: null },
        pending:   { col: '#474e59', w: 2.2, op: 0.5, dash: `${P(8)} ${P(7)}` },
        dim:       { col: '#3b424b', w: 2, op: 0.32, dash: null },
        active:    { col: accent, w: 3.4, op: 1, dash: null, glow: true },
        focus:     { col: accent, w: 3.7, op: 1, dash: null, glow: true },
        generated: { col: '#f6a93a', w: 3.1, op: 0.97, dash: `${P(10)} ${P(7)}`, gen: true },
        genfocus:  { col: '#ffb347', w: 3.7, op: 1, dash: `${P(10)} ${P(7)}`, gen: true, glow: true },
      };
      // order: dim/done/pending first, active + generated + focus on top
      const rank = (s) => ({ focus: 5, genfocus: 5, active: 4, generated: 3, done: 1, pending: 1, dim: 0 }[s] || 0);
      const order = routine.map((r, i) => i).sort((a, b) => rank(routine[a].state) - rank(routine[b].state));
      order.forEach((ri) => {
        const rp = routine[ri]; if (!rp.pts || rp.pts.length < 2) return;
        const S = STYLE[rp.state] || STYLE.pending;
        let d = '';
        rp.pts.forEach((p, k) => { const q = W2P(p); d += (k ? ' L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); });
        // glow / casing under emphasized paths
        if (S.glow) els.push(h('path', { key: 'rg' + ri, d, fill: 'none', stroke: S.col, strokeOpacity: 0.22, strokeWidth: P(S.w + 9), strokeLinecap: 'round', strokeLinejoin: 'round', style: { pointerEvents: 'none' } }));
        if (rp.state === 'active' || rp.state === 'focus') els.push(h('path', { key: 'rc' + ri, d, fill: 'none', stroke: '#05060a', strokeOpacity: 0.7, strokeWidth: P(S.w + 2.5), strokeLinecap: 'round', strokeLinejoin: 'round', style: { pointerEvents: 'none' } }));
        els.push(h('path', { key: 'rp' + ri, className: S.gen ? 'acq-genpath' : undefined, d, fill: 'none', stroke: S.col, strokeOpacity: S.op, strokeWidth: P(S.w), strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: S.dash || undefined, style: { pointerEvents: 'none' } }));
        els.push(h('path', { key: 'rh' + ri, d, fill: 'none', stroke: 'transparent', strokeWidth: P(16), strokeLinecap: 'round', 'data-role': 'rpath', 'data-idx': rp.nodeId, style: { cursor: 'pointer' } }));
        // endpoint nodes
        const a = W2P(rp.pts[0]), b = W2P(rp.pts[rp.pts.length - 1]);
        const endCol = S.gen ? S.col : null;
        [[a, '#4bbf86'], [b, '#d2655f']].forEach(([c, dc], di) => {
          els.push(h('rect', { key: 'rn' + ri + di, x: c.x - P(4.5), y: c.y - P(4.5), width: P(9), height: P(9), rx: S.gen ? P(4.5) : P(1.5), fill: '#14161a', stroke: rp.state === 'pending' || rp.state === 'dim' ? '#5b636e' : (endCol || dc), strokeWidth: P(1.8), style: { pointerEvents: 'none' } }));
        });
        // runtime bolt marker for generated paths (start)
        if (S.gen && rp.state !== 'dim') {
          els.push(h('g', { key: 'rb' + ri, transform: `translate(${a.x} ${a.y - P(20)})`, style: { pointerEvents: 'none' } },
            h('circle', { r: P(8.5), fill: 'rgba(20,16,10,0.92)', stroke: S.col, strokeWidth: P(1.4) }),
            h('path', { d: `M ${P(1.5)} ${-P(4.5)} L ${-P(3)} ${P(0.8)} L ${P(0.2)} ${P(0.8)} L ${-P(1.5)} ${P(4.5)} L ${P(3)} ${-P(0.8)} L ${P(0.2)} ${-P(0.8)} Z`, fill: S.col })));
        }
        // mid label
        const mid = W2P(rp.pts[Math.floor(rp.pts.length / 2)]);
        const dim = rp.state === 'dim' || rp.state === 'pending';
        const lblCol = (rp.state === 'active' || rp.state === 'focus') ? accent : S.gen ? S.col : '#8b94a2';
        const txt = (S.gen ? '\u26a1 ' : (rp.idxLabel ? rp.idxLabel + '  ' : '')) + (rp.label || '');
        const tw = P(8.0 * txt.length + 18), th = P(17);
        els.push(h('g', { key: 'rl' + ri, transform: `translate(${mid.x} ${mid.y - P(15)})`, style: { pointerEvents: 'none' }, opacity: dim ? 0.55 : 1 },
          h('rect', { x: -tw / 2, y: -th / 2, width: tw, height: th, rx: P(3), fill: 'rgba(11,12,14,0.92)', stroke: (rp.state === 'active' || rp.state === 'focus') ? accent : S.gen ? S.col : '#2a2e34', strokeWidth: P(1) }),
          h('text', { x: 0, y: P(3.8), fill: lblCol, fontSize: P(11), fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, textAnchor: 'middle' }, txt)));
      });
      return els;
    }, [routine, accent, view.w, cw, flip]);

    const routineRobot = useMemo(() => {
      if (!routine || !routinePose) return null;
      const c = W2P(routinePose);
      const degHead = (routinePose.heading || 0) * 180 / Math.PI + (flip ? 180 : 0);
      const rw = robot.w * SX, rh = robot.l * SY;
      const bump = alliance === 'red' ? '#c75450' : '#4271c0';
      return h('g', { transform: `translate(${c.x} ${c.y}) rotate(${-degHead})`, style: { pointerEvents: 'none' } },
        h('rect', { x: -rw / 2, y: -rh / 2, width: rw, height: rh, rx: P(2.5), fill: 'rgba(14,16,20,0.85)', stroke: bump, strokeWidth: P(3) }),
        h('line', { x1: 0, y1: 0, x2: rw / 2 + P(3), y2: 0, stroke: '#e8ecf2', strokeWidth: P(2.5) }),
        h('path', { d: `M ${rw / 2 + P(1)} ${-P(6)} L ${rw / 2 + P(13)} 0 L ${rw / 2 + P(1)} ${P(6)} Z`, fill: '#e8ecf2' }));
    }, [routine, routinePose, alliance, robot, view.w, cw, flip]);

    const previewEl = (preview && pts.length > 1) ? (function () {
      const lo = Math.min(preview.f0, preview.f1), hi = Math.max(preview.f0, preview.f1);
      const totalS = derived.sample.length || 1;
      let dd = '', started = false;
      for (let k = 0; k < pts.length; k++) { const f = pts[k].s / totalS; if (f >= lo && f <= hi) { const q = W2P(pts[k]); dd += (started ? ' L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1); started = true; } }
      return dd ? h('path', { d: dd, fill: 'none', stroke: accent, strokeOpacity: 0.45, strokeWidth: P(12), strokeLinecap: 'round', style: { pointerEvents: 'none' } }) : null;
    })() : null;

    const snapEl = (snap && doc.waypoints[snap.idx]) ? (function () { const c = W2P(doc.waypoints[snap.idx]); return h('g', { transform: `translate(${c.x} ${c.y - P(34)})`, style: { pointerEvents: 'none' } }, h('rect', { x: -P(37), y: -P(11), width: P(74), height: P(20), rx: P(4), fill: 'rgba(11,12,14,0.95)', stroke: accent, strokeWidth: P(1) }), h('text', { x: 0, y: P(4), fill: accent, fontSize: P(11), fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, textAnchor: 'middle' }, snap.label)); })() : null;

    const vb = `${view.x} ${view.y} ${view.w} ${view.h}`;
    const cursor = drag.current && drag.current.moved && drag.current.role === 'bg' ? 'grabbing' : (tool === 'waypoint' || tool === 'rotation' || tool === 'marker') ? 'crosshair' : 'default';

    return h('svg', {
      ref: svgRef, className: 'fieldsvg', viewBox: vb, preserveAspectRatio: 'xMidYMid meet',
      onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onWheel: onWheel, onDoubleClick: onDbl,
      style: { cursor, userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' },
      onContextMenu: onCtx, onDragStart: (e) => e.preventDefault(), draggable: false,
    },
      h('rect', { x: -2000, y: -2000, width: IMG_W + 4000, height: IMG_H + 4000, fill: '#0a0b0d', 'data-role': 'bg' }),
      h('rect', { x: X0 - 6, y: Y0 - 6, width: (X1 - X0) + 12, height: (Y1 - Y0) + 12, rx: 4, fill: '#131418', stroke: '#2a2d33', strokeWidth: P(1.5), 'data-role': 'bg' }),
      h('foreignObject', { x: 0, y: 0, width: IMG_W, height: IMG_H, 'data-role': 'bg', style: { pointerEvents: 'none' } },
        h('img', { src: (window.__resources && window.__resources.fieldImg) || 'uploads/FE-2026-_REBUILT_Playing_Field.png', width: IMG_W, height: IMG_H, draggable: false, style: { width: IMG_W + 'px', height: IMG_H + 'px', display: 'block', opacity: 0.9, filter: 'brightness(0.38) saturate(0.32) contrast(1.06)', WebkitUserDrag: 'none', userSelect: 'none', pointerEvents: 'none' } })),
      h('rect', { x: X0 - 6, y: Y0 - 6, width: (X1 - X0) + 12, height: (Y1 - Y0) + 12, rx: 4, fill: 'none', stroke: '#ffffff', strokeOpacity: 0.07, strokeWidth: P(1), style: { pointerEvents: 'none' } }),
      routine ? routineLayers : staticLayers,
      routine ? null : previewEl,
      routine ? routineRobot : robotEl,
      routine ? null : snapEl,
    );
  }

  window.FieldView = FieldView;
  window.FIELD_DIMS = { FIELD_W, FIELD_H, IMG_W, IMG_H };
})();
