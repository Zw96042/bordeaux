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
      const ctm = svg.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      const u = pt.matrixTransform(ctm.inverse());
      const mx = (u.x - X0) / SX, my = (Y1 - u.y) / SY;
      const world = tf({ x: mx, y: my });
      return bounded ? clampWorld(world) : world;
    }, [tf]);

    useEffect(() => {
      const svg = svgRef.current; if (!svg) return;
      const ro = new ResizeObserver(() => setCw(svg.clientWidth || 1200));
      ro.observe(svg); setCw(svg.clientWidth || 1200);
      return () => ro.disconnect();
    }, []);

    // report selected element's screen position for the floating inspector
    useEffect(() => {
      const svg = svgRef.current; if (!svg || !onSelPos) return;
      const pp = derived.sample.pts;
      let wpoint = null;
      if (sel.kind === 'wp' && doc.waypoints[sel.idx]) wpoint = doc.waypoints[sel.idx];
      else if (sel.kind === 'rt' && doc.targets[sel.idx]) wpoint = window.PM.pointAtFraction(window.PM.featureFraction(doc.targets[sel.idx], derived.sample), pp);
      else if (sel.kind === 'em' && doc.markers[sel.idx]) wpoint = window.PM.pointAtFraction(window.PM.featureFraction(doc.markers[sel.idx], derived.sample), pp);
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
    const pts = derived.sample.pts;
    const visitTolerance = P(18) / Math.min(SX, SY);

    const updateVisitFocus = useCallback((next) => {
      visitFocusRef.current = next;
      setVisitFocus(next);
    }, []);

    useEffect(() => updateVisitFocus(null), [doc.id, updateVisitFocus]);

    const visitsAt = useCallback((world) => {
      const candidates = window.PM.nearestVisits(world.x, world.y, pts, { tolerance: visitTolerance });
      if (!derived.wpFrac || derived.wpFrac.length < 2) return candidates;
      return candidates.map((candidate) => {
        let seg = derived.wpFrac.length - 2;
        for (let i = 0; i < derived.wpFrac.length - 1; i++) {
          if (candidate.f <= derived.wpFrac[i + 1] + 1e-9) { seg = i; break; }
        }
        return { ...candidate, seg };
      });
    }, [pts, visitTolerance, derived.wpFrac]);

    const resolveVisit = useCallback((world, options) => {
      const opts = options || {}, candidates = visitsAt(world);
      if (!candidates.length) return null;
      const previous = visitFocusRef.current;
      const sameConflict = previous && previous.candidates.length === candidates.length
        && Math.hypot(previous.anchor.x - world.x, previous.anchor.y - world.y) <= visitTolerance * 0.8
        && previous.candidates.every((candidate, index) => Math.abs(candidate.f - candidates[index].f) <= 0.01);
      let affinityIndex = 0;
      if (Number.isFinite(opts.nearFraction)) {
        for (let i = 1; i < candidates.length; i++) {
          if (Math.abs(candidates[i].f - opts.nearFraction) < Math.abs(candidates[affinityIndex].f - opts.nearFraction)) affinityIndex = i;
        }
      } else {
        for (let i = 1; i < candidates.length; i++) {
          if (candidates[i].distance < candidates[affinityIndex].distance) affinityIndex = i;
        }
      }
      const index = opts.cycle && sameConflict
        ? (previous.index + 1) % candidates.length
        : (sameConflict && opts.preserve !== false && !Number.isFinite(opts.nearFraction) ? previous.index : affinityIndex);
      const next = { candidates, index, anchor: { x: world.x, y: world.y } };
      updateVisitFocus(next);
      return candidates[index];
    }, [visitsAt, visitTolerance, updateVisitFocus]);

    const projectVisit = useCallback((world, nearFraction) => resolveVisit(world, { nearFraction, preserve: false }), [resolveVisit]);

    const resolveWaypointVisit = useCallback((world, cycle, preferredIndex) => {
      if (!derived.wpFrac) return null;
      const candidates = doc.waypoints.map((waypoint, index) => ({
        x: waypoint.x,
        y: waypoint.y,
        f: Number.isFinite(derived.wpFrac[index]) ? derived.wpFrac[index] : 0,
        seg: Math.min(index, Math.max(0, doc.waypoints.length - 2)),
        wp: index,
        distance: Math.hypot(waypoint.x - world.x, waypoint.y - world.y),
      })).filter((candidate) => candidate.distance <= visitTolerance)
        .sort((a, b) => a.wp - b.wp);
      if (candidates.length < 2) return candidates[0] || null;
      const previous = visitFocusRef.current;
      const sameConflict = previous && previous.candidates.length === candidates.length
        && previous.candidates.every((candidate, index) => candidate.wp === candidates[index].wp);
      let index = Number.isInteger(preferredIndex) ? candidates.findIndex((candidate) => candidate.wp === preferredIndex) : -1;
      if (index < 0) {
        index = 0;
        for (let i = 1; i < candidates.length; i++) if (candidates[i].distance < candidates[index].distance) index = i;
      }
      if (cycle && sameConflict) index = (previous.index + 1) % candidates.length;
      const next = { candidates, index, anchor: { x: world.x, y: world.y } };
      updateVisitFocus(next);
      return candidates[index];
    }, [derived.wpFrac, doc.waypoints, visitTolerance, updateVisitFocus]);

    useEffect(() => {
      if (!pts.length) { updateVisitFocus(null); return; }
      let fraction = null;
      if (sel.kind === 'seg' && derived.wpFrac && derived.wpFrac.length > sel.idx + 1) fraction = (derived.wpFrac[sel.idx] + derived.wpFrac[sel.idx + 1]) / 2;
      else if (sel.kind === 'wp' && derived.wpFrac && Number.isFinite(derived.wpFrac[sel.idx])) fraction = derived.wpFrac[sel.idx];
      else if (sel.kind === 'rt' && doc.targets[sel.idx]) fraction = window.PM.featureFraction(doc.targets[sel.idx], derived.sample);
      else if (sel.kind === 'em' && doc.markers[sel.idx]) fraction = window.PM.featureFraction(doc.markers[sel.idx], derived.sample);
      else if (sel.kind === 'cr' && doc.ranges && doc.ranges[sel.idx]) {
        const range = (derived.effRanges && derived.effRanges[sel.idx]) || doc.ranges[sel.idx];
        fraction = (range.f0 + range.f1) / 2;
      }
      if (!Number.isFinite(fraction)) return;
      const current = visitFocusRef.current && visitFocusRef.current.candidates[visitFocusRef.current.index];
      if (sel.kind === 'wp' && doc.waypoints[sel.idx]) {
        const waypoint = doc.waypoints[sel.idx];
        const coincidentCount = doc.waypoints.reduce((count, candidate) => count + Number(Math.hypot(candidate.x - waypoint.x, candidate.y - waypoint.y) <= visitTolerance), 0);
        if (coincidentCount > 1) {
          if (current && current.wp === sel.idx) return;
          resolveWaypointVisit(waypoint, false, sel.idx);
          return;
        }
      }
      if (sel.kind === 'seg' && current && current.seg === sel.idx) return;
      if (current && !Number.isInteger(current.wp) && Math.abs(current.f - fraction) <= 0.015) return;
      const point = window.PM.pointAtFraction(fraction, pts);
      resolveVisit(point, { nearFraction: fraction, preserve: false });
    }, [sel, doc, derived, pts, visitTolerance, resolveVisit, resolveWaypointVisit, updateVisitFocus]);

    useEffect(() => {
      const onVisitKey = (event) => {
        const target = event.target;
        if (target && ((target.matches && target.matches('input, textarea, select')) || target.isContentEditable)) return;
        if (event.key === 'Escape' && visitFocusRef.current) { updateVisitFocus(null); return; }
        const direction = event.key === ']' || event.code === 'BracketRight' ? 1
          : (event.key === '[' || event.code === 'BracketLeft' ? -1 : 0);
        if (!direction) return;
        const current = visitFocusRef.current;
        if (!current || current.candidates.length < 2) return;
        event.preventDefault();
        const index = (current.index + direction + current.candidates.length) % current.candidates.length;
        const next = { ...current, index };
        updateVisitFocus(next);
        const candidate = next.candidates[index];
        if (actionsRef.current.select) actionsRef.current.select(Number.isInteger(candidate.wp) ? 'wp' : 'seg', Number.isInteger(candidate.wp) ? candidate.wp : candidate.seg);
      };
      window.addEventListener('keydown', onVisitKey, true);
      return () => window.removeEventListener('keydown', onVisitKey, true);
    }, [updateVisitFocus]);

    // ---- pointer handling ----
    const startRangeDrag = (world, initialVisit) => {
      const visit = initialVisit || resolveVisit(world);
      const f0 = visit ? visit.f : window.PM.nearestFraction(world.x, world.y, pts);
      drag.current = { role: 'newrange', f0, f1: f0, lastF: f0, moved: false };
      setPreview({ f0, f1: f0 });
    };

    const inspectIdentity = (eventTarget) => {
      const target = eventTarget.closest ? eventTarget.closest('[data-role]') : eventTarget;
      const role = target && target.getAttribute && target.getAttribute('data-role');
      const index = parseInt(target && target.getAttribute && target.getAttribute('data-idx'), 10);
      let kind = null;
      if (role === 'wp' || role === 'head' || role === 'ct') kind = 'wp';
      else if (role === 'rt' || role === 'rth') kind = 'rt';
      else if (role === 'em') kind = 'em';
      else if (role === 'cr' || role === 'rs' || role === 're') kind = 'cr';
      else if (role === 'seg' || role === 'look') kind = 'seg';
      if (!kind || !Number.isInteger(index)) return null;
      let selectedIndex = role === 'ct' ? index >> 1 : index;
      if (kind === 'seg' && visitFocusRef.current) {
        const focused = visitFocusRef.current.candidates[visitFocusRef.current.index];
        if (focused && Number.isInteger(focused.seg)) selectedIndex = focused.seg;
      }
      return { kind, selectedIndex, pressKey: kind + ':' + selectedIndex };
    };

    const inspectTarget = (eventTarget) => {
      const item = inspectIdentity(eventTarget);
      if (!item) return false;
      actions.select(item.kind, item.selectedIndex);
      if (actions.openInspector) actions.openInspector();
      return true;
    };

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
      if (e.button === 0 && e.shiftKey) {
        const idx = parseInt(t.getAttribute && t.getAttribute('data-idx'), 10);
        let removed = false;
        if (role === 'wp' && doc.waypoints.length > 2 && actions.delWp) { actions.delWp(idx); removed = true; }
        else if ((role === 'rt' || role === 'rth') && actions.delTarget) { actions.delTarget(idx); removed = true; }
        else if (role === 'em' && actions.delMarker) { actions.delMarker(idx); removed = true; }
        else if ((role === 'cr' || role === 'rs' || role === 're') && actions.delRange) { actions.delRange(idx); removed = true; }
        if (removed) { drag.current = null; return; }
      }
      const inspectItem = e.button === 0 ? inspectIdentity(t) : null;
      const pendingInspect = lastInspectPress.current;
      const candidateInspectDouble = inspectItem && pendingInspect.key === inspectItem.pressKey
        && performance.now() - pendingInspect.at <= 550;
      if (!inspectItem) lastInspectPress.current = { key: null, at: 0 };
      if (e.button === 0 && tool === 'waypoint' && !e.altKey) {
        drag.current = { role: 'bg', insertWaypoint: false, start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, world, moved: false, mid: false };
        return;
      }
      if (role === 'head') {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        actions.select('wp', idx);
        drag.current = { role: 'head', idx, inspectItem: { kind: 'wp', selectedIndex: idx, pressKey: 'wp:' + idx }, moved: false, historyStarted: false };
        return;
      }
      if (role === 'seg') {
        const idx = parseInt(t.getAttribute('data-idx'), 10);
        const visit = resolveVisit(world, { cycle: tool === 'select' && !e.altKey && !candidateInspectDouble });
        if (tool === 'range' && pts.length > 1) { startRangeDrag(world, visit); return; }
        if (e.altKey || tool === 'rotation' || tool === 'marker') drag.current = { role: 'bg', onPath: true, segment: visit ? visit.seg : idx, visit, insertWaypoint: e.altKey, start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, world, moved: false, mid: false };
        else {
          const selectedIndex = visit ? visit.seg : idx;
          actions.select('seg', selectedIndex);
          drag.current = { role: 'inspect', inspectItem: { kind: 'seg', selectedIndex, pressKey: 'seg:' + selectedIndex }, start: { cx: e.clientX, cy: e.clientY }, moved: false };
        }
        return;
      }
      if (role && role !== 'bg' && role !== 'ins') {
        let idx = parseInt(t.getAttribute('data-idx'), 10);
        let cycleWaypoint = false;
        if (role === 'wp' && tool === 'select') {
          const preferred = sel.kind === 'wp' ? sel.idx : idx;
          cycleWaypoint = sel.kind === 'wp' && sel.idx === idx;
          const visit = resolveWaypointVisit(world, false, preferred);
          if (visit && Number.isInteger(visit.wp)) idx = visit.wp;
        }
        let lastF = null;
        if (role === 'rt' && doc.targets[idx]) lastF = window.PM.featureFraction(doc.targets[idx], derived.sample);
        else if (role === 'em' && doc.markers[idx]) lastF = window.PM.featureFraction(doc.markers[idx], derived.sample);
        else if ((role === 'rs' || role === 're') && doc.ranges && doc.ranges[idx]) {
          const range = (derived.effRanges && derived.effRanges[idx]) || doc.ranges[idx];
          lastF = role === 'rs' ? range.f0 : range.f1;
        }
        let dragInspectItem = inspectItem;
        if (inspectItem && role === 'wp') dragInspectItem = { kind: 'wp', selectedIndex: idx, pressKey: 'wp:' + idx };
        drag.current = { role, idx, lastF, world, cycleWaypoint, inspectItem: dragInspectItem, moved: false, historyStarted: false };
        if (role === 'ct') actions.select('wp', idx >> 1);
        else if (role === 'rs' || role === 're') actions.select('cr', idx);
        else if (role === 'rth') actions.select('rt', idx);
        else if (role === 'look') actions.select('seg', idx);
        else if (role === 'cr') actions.select('cr', idx);
        else if (role === 'wp' || role === 'rt' || role === 'em') actions.select(role, idx);
        return;
      }
      if (tool === 'range' && pts.length > 1) {
        startRangeDrag(world);
        return;
      }
      const visit = role === 'ins' ? resolveVisit(world, { cycle: tool === 'select' }) : null;
      drag.current = { role: 'bg', onPath: role === 'ins', segment: visit && visit.seg, visit, insertWaypoint: e.altKey, start: { cx: e.clientX, cy: e.clientY }, vb0: { ...view }, world, moved: false, mid: e.button === 1 };
    };

    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      const world = clientToWorld(e.clientX, e.clientY, d.role !== 'ct');
      if (d.role === 'inspect') {
        const dx = e.clientX - d.start.cx, dy = e.clientY - d.start.cy;
        if (Math.hypot(dx, dy) > 4) d.moved = true;
        return;
      }
      if (d.role === 'bg') {
        const dx = e.clientX - d.start.cx, dy = e.clientY - d.start.cy;
        if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
        if (d.moved) setView({ x: d.vb0.x - dx * upp, y: d.vb0.y - dy * upp, w: d.vb0.w, h: d.vb0.h });
        return;
      }
      if (d.role === 'newrange') { const visit = projectVisit(world, d.lastF); d.f1 = visit ? visit.f : window.PM.nearestFraction(world.x, world.y, pts); d.lastF = d.f1; d.moved = true; setPreview({ f0: d.f0, f1: d.f1 }); return; }
      if (d.role === 'head') {
        const w = doc.waypoints[d.idx];
        if (w) {
          if (!d.historyStarted && actions.beginHistory) { actions.beginHistory(); d.historyStarted = true; }
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
      if (!d.historyStarted && actions.beginHistory) { actions.beginHistory(); d.historyStarted = true; }
      const p = d.role === 'ct' ? world : clampWorld(world);
      if (d.role === 'wp') actions.moveWaypoint(d.idx, p);
      else if (d.role === 'ct') actions.moveHandle(d.idx >> 1, d.idx & 1, p);
      else if (d.role === 'rt') { const visit = projectVisit(world, d.lastF); if (visit) d.lastF = visit.f; actions.moveTargetTo(d.idx, world, visit && visit.f); }
      else if (d.role === 'rth') actions.rotateTargetTo(d.idx, world, e.shiftKey);
      else if (d.role === 'look') actions.moveSegmentLookAt(d.idx, p);
      else if (d.role === 'em') { const visit = projectVisit(world, d.lastF); if (visit) d.lastF = visit.f; actions.moveMarkerTo(d.idx, world, visit && visit.f); }
      else if (d.role === 'rs') { const visit = projectVisit(world, d.lastF); const f = visit ? visit.f : window.PM.nearestFraction(world.x, world.y, pts); d.lastF = f; actions.moveRangeHandle(d.idx, 0, f); }
      else if (d.role === 're') { const visit = projectVisit(world, d.lastF); const f = visit ? visit.f : window.PM.nearestFraction(world.x, world.y, pts); d.lastF = f; actions.moveRangeHandle(d.idx, 1, f); }
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
      // Pointer capture and preventDefault make Chromium's native dblclick
      // unreliable on the SVG. Count only released, unmoved presses so a fast
      // second drag never gets mistaken for an inspector gesture.
      if (d.inspectItem) {
        const previous = lastInspectPress.current;
        if (d.moved) {
          if (previous.key === d.inspectItem.pressKey) lastInspectPress.current = { key: null, at: 0 };
        } else {
          const now = performance.now();
          if (previous.key === d.inspectItem.pressKey && now - previous.at <= 550) {
            actions.select(d.inspectItem.kind, d.inspectItem.selectedIndex);
            if (actions.openInspector) actions.openInspector();
            lastInspectPress.current = { key: null, at: 0 };
            return;
          }
          lastInspectPress.current = { key: d.inspectItem.pressKey, at: now };
        }
      }
      if (d.role === 'wp' && !d.moved && d.cycleWaypoint) {
        const visit = resolveWaypointVisit(d.world, true);
        if (visit && Number.isInteger(visit.wp)) actions.select('wp', visit.wp);
        return;
      }
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
