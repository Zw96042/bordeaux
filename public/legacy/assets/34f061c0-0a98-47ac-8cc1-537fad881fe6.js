// Bordeaux — app root. Needs React, ReactDOM, PM, UI, FieldView, ContextInspector, Panels, RobotPage.
(function () {
  const { useState, useRef, useEffect, useMemo, useCallback } = React;
  const h = React.createElement;
  const { FIELD_W, FIELD_H, IMG_W, IMG_H } = window.FIELD_DIMS;
  const PERSEG = 56;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });
  const pathId = () => 'path_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const markerId = () => 'event_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const LV_DEFAULTS = { samplePeriodS: 0.02, minTurnRadiusM: 0.5, bezierTangentMode: 'handles', reversePath: false, zeroVelocity: false, pickupBalls: false, currentLimit: 0, zeroTranslationalVelocity: false, correctAtBeginningOfPath: false };

  function normalizeProject(raw) {
    const project = clone(raw);
    const used = new Set();
    (project.paths || []).forEach((p) => {
      if (!p.id) { do { p.id = pathId(); } while (used.has(p.id)); }
      used.add(p.id);
      p.labview = { ...LV_DEFAULTS, ...(p.labview || {}) };
      if (Array.isArray(p.waypoints)) p.waypoints = buildWps(p.waypoints);
      (p.markers || []).forEach((marker) => { if (!marker.id) marker.id = markerId(); });
    });
    const walk = (nodes) => (nodes || []).forEach((node) => {
      if (node.type === 'path' && typeof node.ref === 'number') node.ref = project.paths[node.ref] ? project.paths[node.ref].id : '';
      if (node.type === 'decision') { walk(node.then); walk(node.else); }
    });
    project.routine = project.routine || { name: 'Autonomous Routine', nodes: [] };
    walk(project.routine.nodes);
    project.plannerId = project.plannerId || 'profiledSpline';
    return project;
  }

  const ACCENT = '#3f6fd0';

  const DEF_CONS = { maxVel: 4.2, maxAccel: 6.5, maxDecel: 6.5, maxAngVel: 540, maxAngAccel: 720, maxAngDecel: 720, maxJerk: 0, maxAngJerk: 0 };
  const NEW_RANGE = { anchor: 'wp', maxVel: 1.5, maxAccel: 2.5, maxDecel: 2.5, maxAngVel: 270, maxAngAccel: 540 };

  function alignWaypointHandles(w) {
    if (!w || !w.prevC || !w.nextC) return;
    const inLen = Math.hypot(w.x - w.prevC.x, w.y - w.prevC.y);
    const outLen = Math.hypot(w.nextC.x - w.x, w.nextC.y - w.y);
    const inX = inLen > 1e-6 ? (w.x - w.prevC.x) / inLen : 0;
    const inY = inLen > 1e-6 ? (w.y - w.prevC.y) / inLen : 0;
    const outX = outLen > 1e-6 ? (w.nextC.x - w.x) / outLen : 0;
    const outY = outLen > 1e-6 ? (w.nextC.y - w.y) / outLen : 0;
    let dx = inX + outX, dy = inY + outY;
    let mag = Math.hypot(dx, dy);
    if (mag < 1e-6) { dx = outLen > 1e-6 ? outX : inX; dy = outLen > 1e-6 ? outY : inY; mag = Math.hypot(dx, dy); }
    if (mag < 1e-6) { dx = 1; dy = 0; mag = 1; }
    dx /= mag; dy /= mag;
    w.prevC = { x: w.x - dx * inLen, y: w.y - dy * inLen };
    w.nextC = { x: w.x + dx * outLen, y: w.y + dy * outLen };
    w.linked = true;
    w.corner = false;
  }

  function buildWps(raw) {
    const out = raw.map((w) => ({ linked: true, thetaOn: false, theta: 0, stop: false, ...w }));
    out.forEach((w, i) => { const hd = window.PM.autoHandles(out, i); if (!w.prevC) w.prevC = hd.prevC; if (!w.nextC) w.nextC = hd.nextC; });
    out.forEach((w, i) => { if (!w.stop && i > 0 && i < out.length - 1) alignWaypointHandles(w); });
    if (out.length) { out[0].thetaOn = true; out[out.length - 1].thetaOn = true; }
    return out;
  }

  function remapWaypointRanges(doc, oldToNew, removedIndex) {
    doc.ranges = (doc.ranges || []).map((range) => window.PM.remapWaypointRange(range, oldToNew, removedIndex, doc.waypoints.length));
  }

  // ---- blank startup path ----
  function blankPath(name) {
    return {
      id: pathId(),
      name,
      waypoints: buildWps([{ x: 2.2, y: 4.0, theta: 0 }, { x: 5.0, y: 4.0, theta: 0 }]),
      targets: [], markers: [],
      ranges: [],
      constraints: { ...DEF_CONS },
      headingMode: 'targets',
      startVel: 0, goalVel: 0,
      labview: { ...LV_DEFAULTS },
    };
  }

  function freshProject() {
    return {
      schemaVersion: '1.0',
      name: 'Untitled',
      robot: { drive: 'swerve', w: 0.84, l: 0.84, heightM: 0.5, maxSpeed: 5.0 },
      paths: [blankPath('NewPath')],
      routine: { name: 'Autonomous Routine', nodes: [] },
      plannerId: 'profiledSpline',
    };
  }

  const FIT = { x: 307, y: 7, w: 3285, h: 1569 };

  function App() {
    const [project, setProject] = useState(() => freshProject());
    const [activeIdx, setActiveIdx] = useState(0);
    const [sel, setSel] = useState({ kind: null, idx: -1 });
    const [page, setPage] = useState('plan');
    const [alliance, setAlliance] = useState('blue');
    const [showGrid, setShowGrid] = useState(true);
    const [view, setView] = useState(FIT);
    const [playTime, setPlayTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [graphOpen, setGraphOpen] = useState(false);
    const [outlineOpen, setOutlineOpen] = useState(true);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [secOpen, setSecOpen] = useState({ wp: true, sg: false, rt: false, em: false, cr: false });
    const [times, setTimes] = useState({});
    const [selPos, setSelPos] = useState(null);
    const [metric, setMetric] = useState('velocity');
    const [tool, setTool] = useState('select');
    const [diagOpen, setDiagOpen] = useState(false);
    const [waypointPreview, setWaypointPreview] = useState(null);
    const [headMenu, setHeadMenu] = useState(null);
    const [plannerId, setPlannerId] = useState('profiledSpline');
    const [dirty, setDirty] = useState(false);
    const [agentProposal, setAgentProposal] = useState(null);
    const [agentCandidateId, setAgentCandidateId] = useState(null);
    const [mcpEnabled, setMcpEnabled] = useState(false);
    const [agentSessionId] = useState(() => 'session_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)));
    const agentRevision = useRef(-1);
    const [javaProjectState, setJavaProjectState] = useState({ status: 'unlinked', operation: null, catalog: null, integration: null, error: '', notice: '', bookmarkId: null, recentProjects: [] });
    const skipDirty = useRef(true);
    const keyboardNavigation = useRef(false);

    useEffect(() => {
      const splash = document.getElementById('boot-splash');
      if (!splash) return;
      const appRoot = document.getElementById('root');
      const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const runner = splash.querySelector('.boot-splash-inner');
    }), [commit]);
    const toggleStop = useCallback((i, on) => commit((d) => { const w = d.waypoints[i]; w.stop = on; if (on) w.linked = false; return d; }), [commit]);
    const toggleTheta = useCallback((i, on) => commit((d) => { d.waypoints[i].thetaOn = on; return d; }), [commit]);
    const setHandleLen = useCallback((i, key, len) => commit((d) => { const w = d.waypoints[i]; const a = Math.atan2(w[key].y - w.y, w[key].x - w.x); w[key] = { x: w.x + Math.cos(a) * len, y: w.y + Math.sin(a) * len }; return d; }), [commit]);
    const delWp = useCallback((i) => { commit((d) => { if (i <= 0 || i >= d.waypoints.length - 1) return d; d.waypoints.splice(i, 1); if (d.waypoints.length) { d.waypoints[0].thetaOn = true; d.waypoints[d.waypoints.length - 1].thetaOn = true; } return d; }); select(null, -1); }, [commit, select]);

    const addTargetAt = useCallback((p) => commit((d) => { const pts = derived.sample.pts; const f = pts.length > 1 ? window.PM.nearestFraction(p.x, p.y, pts) : 0.5; const deg = pts.length > 1 ? window.PM.pointAtFraction(f, pts).heading * 180 / Math.PI : 0; d.targets.push({ f, deg }); if ((d.headingMode || 'targets') !== 'targets') d.headingMode = 'targets'; d._selT = d.targets.length - 1; return d; }), [commit, derived]);
    const addMarkerAt = useCallback((p) => commit((d) => { const f = derived.sample.pts.length > 1 ? window.PM.nearestFraction(p.x, p.y, derived.sample.pts) : 0.5; d.markers.push({ f, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit, derived]);
    useEffect(() => { if (doc._selT != null) { select('rt', doc._selT); mutate((d) => { delete d._selT; return d; }); } }, [doc._selT]);
    useEffect(() => { if (doc._selM != null) { select('em', doc._selM); mutate((d) => { delete d._selM; return d; }); } }, [doc._selM]);

    const moveTargetTo = useCallback((i, p) => mutate((d) => { d.targets[i].f = window.PM.nearestFraction(p.x, p.y, derived.sample.pts); return d; }), [mutate, derived]);
    const moveMarkerTo = useCallback((i, p) => mutate((d) => { d.markers[i].f = window.PM.nearestFraction(p.x, p.y, derived.sample.pts); return d; }), [mutate, derived]);
    const setTarget = useCallback((i, patch) => commit((d) => { Object.assign(d.targets[i], patch); return d; }), [commit]);
    const delTarget = useCallback((i) => { commit((d) => { d.targets.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);
    const setMarker = useCallback((i, patch) => commit((d) => { Object.assign(d.markers[i], patch); return d; }), [commit]);
    const delMarker = useCallback((i) => { commit((d) => { d.markers.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);

    const addRange = useCallback((f0, f1) => commit((d) => {
      if (!d.ranges) d.ranges = [];
      const a = Math.max(0, Math.min(f0, f1)), b = Math.min(1, Math.max(f0, f1));
      const c = d.constraints;
      // purely where it was drawn (percent of path), inheriting the global limits
      d.ranges.push({ f0: a, f1: b, anchor: 'param', maxVel: c.maxVel, maxAccel: c.maxAccel, maxDecel: (c.maxDecel != null ? c.maxDecel : c.maxAccel), maxAngVel: c.maxAngVel, maxAngAccel: c.maxAngAccel });
      d._selR = d.ranges.length - 1; return d;
    }), [commit]);
    const setRange = useCallback((i, patch) => commit((d) => { Object.assign(d.ranges[i], patch); return d; }), [commit]);
    const delRange = useCallback((i) => { commit((d) => { d.ranges.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);
    const moveRangeHandle = useCallback((i, which, f) => mutate((d) => {
      const rg = d.ranges[i]; const key = which ? 'f1' : 'f0'; const cf = Math.max(0, Math.min(1, f));
      const len = derived.sample.length || 1;
      if (rg.anchor === 'dist') { rg[which ? 'd1' : 'd0'] = +(cf * len).toFixed(2); }
      else if (rg.anchor === 'wp') { const wf = window.PM.waypointFracs(d, derived.sample); let best = 0, bd = Infinity; wf.forEach((wfr, k) => { const dd = Math.abs(wfr - cf); if (dd < bd) { bd = dd; best = k; } }); rg[which ? 'w1' : 'w0'] = best; }
      else { rg[key] = cf; }
      return d;
    }), [mutate, derived]);
    useEffect(() => { if (doc._selR != null) { select('cr', doc._selR); mutate((d) => { delete d._selR; return d; }); } }, [doc._selR]);

    const setConstraint = useCallback((patch) => commit((d) => { Object.assign(d.constraints, patch); return d; }), [commit]);
    const setDoc = useCallback((patch) => commit((d) => Object.assign(d, patch)), [commit]);
    const rename = useCallback((nm) => mutate((d) => { d.name = nm; return d; }), [mutate]);
    const setRobot = useCallback((patch) => setProject((pr) => ({ ...pr, robot: { ...pr.robot, ...patch } })), []);

    // ---- modeless “add” actions (no tool modes): create + select, then edit on canvas / inspector ----
    const addWaypointEnd = useCallback(() => commit((d) => {
      const wps = d.waypoints; const n = wps.length;
      const last = wps[n - 1], prev = wps[n - 2] || last;
      let dx = last.x - prev.x, dy = last.y - prev.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const nx = Math.max(0.3, Math.min(FIELD_W - 0.3, last.x + dx * 1.6));
      const ny = Math.max(0.3, Math.min(FIELD_H - 0.3, last.y + dy * 1.6));
      const nw = { x: nx, y: ny, linked: true, thetaOn: false, theta: last.theta || 0, stop: false, segType: last.segType || 'bezier' };
      wps.push(nw);
      const hd = window.PM.autoHandles(wps, wps.length - 1); nw.prevC = hd.prevC; nw.nextC = hd.nextC;
      wps[wps.length - 1].thetaOn = true;
      d._selAfter = wps.length - 1; return d;
    }), [commit]);
    const addTargetMid = useCallback(() => commit((d) => { const pts = derived.sample.pts; const deg = pts.length > 1 ? window.PM.pointAtFraction(0.5, pts).heading * 180 / Math.PI : 0; d.targets.push({ f: 0.5, deg }); if ((d.headingMode || 'targets') !== 'targets') d.headingMode = 'targets'; d._selT = d.targets.length - 1; return d; }), [commit, derived]);
    const addMarkerMid = useCallback(() => commit((d) => { d.markers.push({ f: 0.5, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit]);
    const addRangeMid = useCallback(() => addRange(0.35, 0.6), [addRange]);

    // ---- segment + waypoint structural ops (memo §3 / §4 / §7 / §8) ----
    const PX = { X0: 397, X1: 3502, Y0: 97, Y1: 1486 };
    const setSegMeta = useCallback((i, patch) => commit((d) => { Object.assign(d.waypoints[i], patch); return d; }), [commit]);
    const setStop = useCallback((i, on) => commit((d) => { const w = d.waypoints[i]; w.stop = on; if (on) { w.linked = false; } else { w.linked = !w.corner; delete w.wait; } return d; }), [commit]);
    const setWait = useCallback((i, sec) => commit((d) => { d.waypoints[i].wait = Math.max(0, sec); return d; }), [commit]);
    const toggleCorner = useCallback((i, on) => commit((d) => { const w = d.waypoints[i]; w.corner = on; w.linked = !on && !w.stop; return d; }), [commit]);
    const setHeadingMode = useCallback((m) => commit((d) => { d.headingMode = m; return d; }), [commit]);
    const toggleDriveBackward = useCallback(() => commit((d) => { d.driveBackward = !d.driveBackward; return d; }), [commit]);
    const nudgeWp = useCallback((i, dx, dy) => commit((d) => { const w = d.waypoints[i]; if (!w) return d; const nx = Math.max(0, Math.min(FIELD_W, w.x + dx)), ny = Math.max(0, Math.min(FIELD_H, w.y + dy)); const ddx = nx - w.x, ddy = ny - w.y; w.x = nx; w.y = ny; if (w.prevC) { w.prevC.x += ddx; w.prevC.y += ddy; } if (w.nextC) { w.nextC.x += ddx; w.nextC.y += ddy; } return d; }), [commit]);
    const nudgeFrac = useCallback((kind, i, df) => commit((d) => { const arr = kind === 'rt' ? d.targets : d.markers; if (arr[i]) arr[i].f = Math.max(0, Math.min(1, arr[i].f + df)); return d; }), [commit]);
    const setWaypointHeading = useCallback((i, deg) => mutate((d) => { const w = d.waypoints[i]; w.theta = deg; w.thetaOn = true; if ((d.headingMode || 'targets') === 'tangent') d.headingMode = 'manual'; return d; }), [mutate]);
    const faceWaypoint = useCallback((i, mode) => commit((d) => {
      const w = d.waypoints[i]; let deg = w.theta || 0;
      if (mode === 'next' && d.waypoints[i + 1]) { const t = d.waypoints[i + 1]; deg = Math.atan2(t.y - w.y, t.x - w.x) * 180 / Math.PI; }
      else if (mode === 'prev' && d.waypoints[i - 1]) { const t = d.waypoints[i - 1]; deg = Math.atan2(t.y - w.y, t.x - w.x) * 180 / Math.PI; }
      else if (mode === 'tangent') { const idx = (derived.wpIdx && derived.wpIdx[i]) || 0; const p = derived.sample.pts[idx]; if (p) deg = (p.heading || 0) * 180 / Math.PI; }
      w.theta = deg; w.thetaOn = true; return d;
    }), [commit, derived]);
    const headingMenu = useCallback((i, x, y) => {
      setHeadMenu({ x, y, items: [
        { label: 'Face next waypoint', icon: 'compass', onClick: () => faceWaypoint(i, 'next') },
        { label: 'Face previous waypoint', icon: 'compass', onClick: () => faceWaypoint(i, 'prev') },
        { label: 'Align to path tangent', icon: 'route', onClick: () => faceWaypoint(i, 'tangent') },
        { sep: true },
        { label: 'Type exact angle\u2026', icon: 'compass', onClick: () => select('wp', i) },
      ] });
    }, [faceWaypoint, select]);
    const duplicateWp = useCallback((i) => commit((d) => {
      const src = JSON.parse(JSON.stringify(d.waypoints[i]));
      const next = clampWorld({ x: src.x + 0.4, y: src.y + 0.4 }); src.x = next.x; src.y = next.y;
      d.waypoints.splice(i + 1, 0, src);
      const hd = window.PM.autoHandles(d.waypoints, i + 1); src.prevC = hd.prevC; src.nextC = hd.nextC;
      d.waypoints[0].thetaOn = true; d.waypoints[d.waypoints.length - 1].thetaOn = true;
      d._selAfter = i + 1; return d;
    }), [commit]);
    const reversePath = useCallback(() => commit((d) => {
      const oldSeg = d.waypoints.map((w) => w.segType);
      const w = d.waypoints.slice().reverse(); const n = w.length;
      w.forEach((x) => { const p = x.prevC; x.prevC = x.nextC; x.nextC = p; });
      for (let j = 0; j < n; j++) { if (j < n - 1) w[j].segType = oldSeg[n - 2 - j]; else delete w[j].segType; }
      d.waypoints = w; const sv = d.startVel, gv = d.goalVel; d.startVel = gv; d.goalVel = sv;
      w[0].thetaOn = true; w[n - 1].thetaOn = true; return d;
    }), [commit]);
    const reorderWp = useCallback((from, to) => commit((d) => {
      const w = d.waypoints; if (to < 0 || to >= w.length || from === to) return d;
      const [m] = w.splice(from, 1); w.splice(to, 0, m);
      w[0].thetaOn = true; w[w.length - 1].thetaOn = true; d._selAfter = to; return d;
    }), [commit]);
    const insertWp = useCallback((i) => commit((d) => {
      const a = d.waypoints[i], b = d.waypoints[i + 1]; if (!a || !b) return d;
      const mid = clampWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const nw = { x: mid.x, y: mid.y, linked: true, thetaOn: false, theta: 0, stop: false, segType: a.segType || 'bezier' };
      d.waypoints.splice(i + 1, 0, nw);
      const hd = window.PM.autoHandles(d.waypoints, i + 1); nw.prevC = hd.prevC; nw.nextC = hd.nextC;
      d._selAfter = i + 1; return d;
    }), [commit]);
    const zoomToFraction = useCallback((f) => {
      const pts = derived.sample.pts; if (!pts || pts.length < 2) return;
      const p = window.PM.pointAtFraction(f, pts);
      const sx = (PX.X1 - PX.X0) / FIELD_W, sy = (PX.Y1 - PX.Y0) / FIELD_H;
      const q = alliance === 'red' ? { x: FIELD_W - p.x, y: FIELD_H - p.y } : p;
      const cx = PX.X0 + q.x * sx, cy = PX.Y1 - q.y * sy;
      const nw = IMG_W * 0.42, nh = nw * (IMG_H / IMG_W);
      setView({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
    }, [derived, alliance]);
    const pickWarning = useCallback((wn) => { select('seg', wn.seg); zoomToFraction(wn.f); setDiagOpen(true); }, [select, zoomToFraction]);
    const applyFix = useCallback((wn, id) => {
      if (id === 'clothoid') setSegMeta(wn.seg, { segType: 'clothoid' });
      else if (id === 'handles') commit((d) => {
        const a = d.waypoints[wn.seg], b = d.waypoints[wn.seg + 1];
        [[a, 'nextC'], [b, 'prevC']].forEach(([w, key]) => { if (!w || !w[key]) return; const ang = Math.atan2(w[key].y - w.y, w[key].x - w.x); const L = Math.hypot(w[key].x - w.x, w[key].y - w.y) * 1.35; w[key] = { x: w.x + Math.cos(ang) * L, y: w.y + Math.sin(ang) * L }; });
        return d;
      });
      else if (id === 'cap') addRange(Math.max(0, wn.f - 0.09), Math.min(1, wn.f + 0.09));
      else if (id === 'angvel') setConstraint({ maxAngVel: +(doc.constraints.maxAngVel * 1.25).toFixed(0) });
      else if (id === 'insert') { const p = window.PM.pointAtFraction(wn.f, derived.sample.pts); addWaypoint(p); }
    }, [setSegMeta, commit, addRange, addWaypoint, setConstraint, doc, derived]);

    const inspActions = { setWp, toggleStop, toggleTheta, setHandleLen, delWp, setTarget, delTarget, setMarker, delMarker, setRange, delRange, setConstraint, setDoc, rename, select, setTool,
      addWaypointEnd, addTargetMid, addMarkerMid, addRangeMid,
      setSegMeta, faceWaypoint, duplicateWp, reversePath, reorderWp, insertWp,
      setStop, setWait, toggleCorner, setHeadingMode, toggleDriveBackward };
    const fieldActions = { addWaypoint, moveWaypoint, moveHandle, addTargetAt, addMarkerAt, moveTargetTo, moveMarkerTo, addRange, moveRangeHandle, beginHistory,
      setWaypointHeading, headingMenu, faceWaypoint, delWp,
      select: (k, i) => { if (k) beginHistory(); select(k, i); } };

    // ---- project ops ----
    const addPath = () => { setProject((pr) => ({ ...pr, paths: [...pr.paths, blankPath('NewPath')] })); setActiveIdx(project.paths.length); setSel({ kind: null, idx: -1 }); hist.current = { past: [], future: [] }; setPage('plan'); };
    const dupPath = (i) => { setProject((pr) => { const cp = clone(pr.paths[i]); cp.name = cp.name + '_copy'; const paths = pr.paths.slice(); paths.splice(i + 1, 0, cp); return { ...pr, paths }; }); };
    const delPath = (i) => { if (project.paths.length <= 1) return; setProject((pr) => { const paths = pr.paths.filter((_, k) => k !== i); return { ...pr, paths }; }); setActiveIdx((a) => Math.max(0, a > i ? a - 1 : a === i ? Math.min(a, project.paths.length - 2) : a)); };
    const renamePath = (i, name) => { const clean = (name || '').trim() || 'NewPath'; setProject((pr) => { const paths = pr.paths.slice(); paths[i] = { ...paths[i], name: clean }; return { ...pr, paths }; }); };
    const setActive = (i) => { setActiveIdx(i); setSel({ kind: null, idx: -1 }); setPlayTime(0); setPlaying(false); hist.current = { past: [], future: [] }; };

    // ---- playback loop ----
    const total = derived.prof.totalTime || 0;
    const totalRef = useRef(0); totalRef.current = total;
    const playRef = useRef(0); playRef.current = playTime;
    useEffect(() => {
      if (!playing) return; let raf, last = performance.now();
      const tick = (now) => { const dt = (now - last) / 1000; last = now; setPlayTime((t) => { let nt = t + dt; if (nt >= total) { nt = total; setPlaying(false); } return nt; }); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    }, [playing, total]);
    useEffect(() => { if (playTime > total) setPlayTime(total); }, [total]);
    const restart = () => { setPlayTime(0); setPlaying(true); };
    const seek = (t) => { setPlaying(false); setPlayTime(Math.max(0, Math.min(total, t))); };

    // ---- routine run engine ----
    const run = useMemo(() => window.AUTO.buildRun(routine, project.paths, robot, routineOutcomes), [routine, project.paths, robot, routineOutcomes]);
    useEffect(() => {
      if (page !== 'auto' || !routinePlaying) return;
      let raf, last = performance.now();
      const tick = (now) => { const dt = (now - last) / 1000; last = now; setRoutineTime((t) => { let nt = t + dt; if (nt >= run.total) { nt = run.total; setRoutinePlaying(false); } return nt; }); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    }, [page, routinePlaying, run.total]);
    useEffect(() => { if (routineTime > run.total) setRoutineTime(run.total); }, [run.total]);

    const acq = useMemo(() => ({
      outcomes: routineOutcomes,
      set: (id, patch) => setRoutine((r) => window.AUTO.update(r, id, patch)),
      del: (id) => { setRoutine((r) => window.AUTO.remove(r, id)); setRoutineSel(null); },
      move: (id, dir) => setRoutine((r) => window.AUTO.move(r, id, dir)),
      reorder: (id, targetId, before) => setRoutine((r) => window.AUTO.reorderRelative(r, id, targetId, before)),
      select: (id) => setRoutineSel(id),
      addAfter: (id, type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat); setRoutineSel(nn.id); return window.AUTO.insertAfter(r, id, nn); }),
      addBranch: (decId, br, type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat); setRoutineSel(nn.id); return window.AUTO.appendBranch(r, decId, br, nn); }),
      addEnd: (type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat); setRoutineSel(nn.id); return window.AUTO.append(r, nn); }),
      prepend: (type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat); setRoutineSel(nn.id); return window.AUTO.prepend(r, nn); }),
      setOutcome: (id, br) => setRoutineOutcomes((o) => ({ ...o, [id]: br })),
      rename: (nm) => setRoutine((r) => ({ ...r, name: nm })),
      openInEditor: (idx) => { setActive(idx); setPage('plan'); },
    }), [routineOutcomes]);
    const routineControls = useMemo(() => ({
      toggle: () => { if (routineTime >= run.total - 1e-6) setRoutineTime(0); setRoutinePlaying((p) => !p); },
      play: () => { if (routineTime >= run.total - 1e-6) setRoutineTime(0); setRoutinePlaying(true); },
      reset: () => { setRoutinePlaying(false); setRoutineTime(0); },
      seek: (t) => { setRoutinePlaying(false); setRoutineTime(Math.max(0, Math.min(run.total, t))); },
      step: (dir) => { setRoutinePlaying(false); const idx = window.AUTO.stepAt(run, routineTime); const ni = Math.max(0, Math.min(run.steps.length - 1, idx + dir)); const s = run.steps[ni]; if (s) setRoutineTime(s.t0 + (s.dur > 0 ? Math.min(0.05, s.dur / 2) : 0)); },
    }), [run, routineTime]);
    const routineRunning = routinePlaying || routineTime > 0.001;
    const routineOverlay = useMemo(() => page === 'auto' ? window.AUTO.fieldOverlay(run, { time: routineTime, running: routineRunning, selectedId: routineSel }) : null, [page, run, routineTime, routineRunning, routineSel]);
    const routinePose = page === 'auto' ? window.AUTO.poseAt(run, routineTime, robot) : null;
    const autoFieldActions = useMemo(() => ({ selectNode: (id) => setRoutineSel((s) => s === id ? null : id), select: () => setRoutineSel(null) }), []);

    // ---- view ----
    const onFit = useCallback(() => setView(FIT), []);
    const zoomBy = useCallback((factor) => setView((v) => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const nw = Math.max(IMG_W * 0.12, Math.min(IMG_W * 1.6, v.w * factor));
      const nh = nw * (IMG_H / IMG_W);
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    }), []);
    const zoomPct = Math.round(FIT.w / view.w * 100);

    // ---- export ----
    const onExport = () => {
      if (window.bordeauxAPI && typeof window.bordeauxAPI.exportBdx === 'function') {
        window.bordeauxAPI.exportBdx({ schemaVersion: '1.0', ...project, plannerId }).catch((err) => {
          console.error('BDX export failed:', err);
          alert('BDX export failed: ' + (err && err.message ? err.message : err));
        });
        return;
      }
      const out = { version: '2.0', name: doc.name, robot: project.robot, ...doc };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = doc.name + '.path'; a.click();
    };

    // ---- keyboard ----
    useEffect(() => {
      const onKey = (e) => {
        if (e.target.matches && e.target.matches('input,select,textarea')) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        if (page !== 'plan') return;
        if (e.key.indexOf('Arrow') === 0 && sel.kind) {
          const base = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05;
          const flip = alliance === 'red' ? -1 : 1;
          let dx = 0, dy = 0;
          if (e.key === 'ArrowUp') dy = base * flip; else if (e.key === 'ArrowDown') dy = -base * flip;
          else if (e.key === 'ArrowRight') dx = base * flip; else if (e.key === 'ArrowLeft') dx = -base * flip;
          if (dx || dy) {
            e.preventDefault();
            if (sel.kind === 'wp') nudgeWp(sel.idx, dx, dy);
            else if (sel.kind === 'rt' || sel.kind === 'em') { const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1; nudgeFrac(sel.kind, sel.idx, dir * (e.shiftKey ? 0.02 : 0.005)); }
          }
          return;
        }
        const k = e.key.toLowerCase();
        if (k === 'v') setTool('select');
        else if (k === 'w') setTool('waypoint');
        else if (k === 'r') setTool('rotation');
        else if (k === 'm') setTool('marker');
        else if (k === 'c') setTool('range');
        else if (k === 'g') setShowGrid((s) => !s);
        else if (k === 'f') setView(FIT);
        else if (e.key === ' ') { e.preventDefault(); const tot = totalRef.current; if (playRef.current >= tot - 1e-3) { setPlayTime(0); setPlaying(true); } else setPlaying((p) => !p); }
        else if (e.key === 'Escape') { setTool('select'); setHeadMenu(null); setDiagOpen(false); select(null, -1); }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && sel.kind) {
          if (sel.kind === 'wp') delWp(sel.idx); else if (sel.kind === 'rt') delTarget(sel.idx); else if (sel.kind === 'em') delMarker(sel.idx); else if (sel.kind === 'cr') delRange(sel.idx);
        }
      };
      window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo, sel, delWp, delTarget, delMarker, delRange, select, page, nudgeWp, nudgeFrac, alliance]);

    useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

    const selNode = (page === 'auto' && routineSel) ? window.AUTO.findNode(routine, routineSel) : null;

    return h('div', { className: 'app' },
      h(window.Panels.Toolbar, { project, page, setPage, alliance, setAlliance, showGrid, setShowGrid, onUndo: undo, onRedo: redo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times, plannerId, setPlannerId }),
      page === 'robot'
        ? h(window.RobotPage, { robot, setRobot, accent })
        : page === 'auto'
        ? h('div', { className: 'stage stage-auto' },
            h('div', { className: 'rail rail-l' },
              h(window.RoutinePanel, { routine, run, paths: project.paths, selId: routineSel, onSelect: setRoutineSel, acq, time: routineTime, running: routineRunning })),
            h('div', { className: 'fieldcol' },
              h(window.FieldView, { doc, derived, sel: { kind: null, idx: -1 }, tool: 'select', view, setView, alliance, showGrid, robot, drive: robot.drive, accent, metric, playTime: 0, actions: autoFieldActions, onSelPos: () => {}, routine: routineOverlay, routinePose }),
              h(window.Panels.RoutineLegend, { run, time: routineTime, running: routineRunning }),
              h(window.RoutineTransport, { run, time: routineTime, playing: routinePlaying, controls: routineControls, running: routineRunning, outcomes: routineOutcomes }),
              h(window.Panels.ViewControls, { zoomPct, zoomBy, onFit })),
            h('div', { className: 'rail rail-r' + (selNode ? '' : ' collapsed') },
              selNode && h(window.StepInspector, { node: selNode, paths: project.paths, acq, run })))
        : h('div', { className: 'stage stage-plan' },
            h('div', { className: 'rail rail-l' + (outlineOpen ? '' : ' collapsed') },
              h(window.Panels.Outline, { open: outlineOpen, setOpen: setOutlineOpen, doc, sel, actions: inspActions, secOpen, setSecOpen, robot })),
            h('div', { className: 'fieldcol' },
              h(window.Panels.ToolRail, { tool, setTool }),
              h(window.FieldView, { doc, derived, sel, tool, view, setView, alliance, showGrid, robot, drive: robot.drive, accent, metric, playTime, playing, actions: fieldActions, onSelPos }),
              tool !== 'select' && h('div', { className: 'stage-hint', dangerouslySetInnerHTML: { __html: toolHint(tool) } }),
              h(window.Panels.ConstraintBar, { c: doc.constraints, robot, active: !sel.kind, onOpen: () => select(null, -1) }),
              h(window.Panels.Overlay, { metric, setMetric, derived, diagOpen, onToggleDiag: () => setDiagOpen((o) => !o), plannerId }),
              diagOpen && h(window.Panels.Diagnostics, { derived, doc, accent, onClose: () => setDiagOpen(false), onPick: pickWarning, onFix: applyFix }),
              h(window.Panels.Transport, { derived, metric, playTime, playing, setPlaying, seek, restart, graphOpen, setGraphOpen }),
              h(window.Panels.ViewControls, { zoomPct, zoomBy, onFit })),
            h('div', { className: 'rail rail-r' },
              h(window.ContextInspector, { doc, sel, derived, actions: inspActions, accent, drive: robot.drive, robot, onClose: () => select(null, -1) })),
            headMenu && h(window.UI.ContextMenu, { x: headMenu.x, y: headMenu.y, items: headMenu.items, onClose: () => setHeadMenu(null) })));
  }

  function toolHint(tool) {
    if (tool === 'waypoint') return 'Click the field to place a <b>waypoint</b> \u00b7 click the path to insert one between';
    if (tool === 'rotation') return 'Click the path to set a <b>rotation target</b>';
    if (tool === 'marker') return 'Click the path to place an <b>event marker</b>';
    if (tool === 'range') return 'Drag along the path to define a <b>constraint range</b> \u00b7 then edit its limits';
    return '';
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
