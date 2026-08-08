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
      const runnerWidth = runner ? runner.getBoundingClientRect().width : 360;
      const travelPx = window.innerWidth / 2 + runnerWidth / 2;
      const strideMs = 460;
      const strideDistancePx = Math.max(1, runnerWidth * 1.7);
      const strideCount = Math.max(1, Math.min(3, Math.ceil(travelPx / strideDistancePx)));
      const runMs = strideCount * strideMs;
      const curtainMs = 280;
      splash.style.setProperty('--boot-run', runMs + 'ms');
      splash.style.setProperty('--boot-curtain', curtainMs + 'ms');
      let removeTimer;
      const revealApp = () => {
        splash.remove();
        if (appRoot) { appRoot.inert = false; appRoot.removeAttribute('inert'); }
      };
      const fadeTimer = window.setTimeout(() => {
        splash.classList.add('boot-splash-ready');
        removeTimer = window.setTimeout(revealApp, reducedMotion ? 0 : runMs + curtainMs + 40);
      }, reducedMotion ? 0 : strideMs / 2);
      return () => { window.clearTimeout(fadeTimer); if (removeTimer) window.clearTimeout(removeTimer); if (appRoot) { appRoot.inert = false; appRoot.removeAttribute('inert'); } };
    }, []);

    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.listRecentJavaProjects !== 'function') return;
      let active = true;
      window.bordeauxAPI.listRecentJavaProjects().then((recentProjects) => {
        if (active) setJavaProjectState((current) => ({ ...current, recentProjects: Array.isArray(recentProjects) ? recentProjects : [] }));
      }).catch((error) => {
        if (active) setJavaProjectState((current) => ({ ...current, error: error && error.message ? error.message : String(error) }));
      });
      return () => { active = false; };
    }, []);

    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.getMcpStatus !== 'function') return;
      let active = true;
      window.bordeauxAPI.getMcpStatus().then((status) => { if (active) setMcpEnabled(Boolean(status && status.enabled)); }).catch(() => undefined);
      const unsubscribe = typeof window.bordeauxAPI.onMcpStatus === 'function'
        ? window.bordeauxAPI.onMcpStatus((status) => { if (active) setMcpEnabled(Boolean(status && status.enabled)); })
        : null;
      return () => { active = false; if (unsubscribe) unsubscribe(); };
    }, []);

    const applyJavaProjectConnection = useCallback((result) => {
      setJavaProjectState({
        status: 'ready',
        operation: null,
        catalog: result.catalog,
        integration: result.integration || null,
        error: '',
        notice: result.warning || '',
        bookmarkId: result.bookmarkId,
        recentProjects: result.recentProjects || [],
      });
    }, []);

    const linkJavaProject = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.linkJavaProject !== 'function') {
        setJavaProjectState((current) => ({ ...current, status: 'error', error: 'Java project discovery is available in the Bordeaux desktop app.' }));
        return;
      }
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.linkJavaProject();
        if (!result) {
          setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'ready' : 'unlinked', operation: null, error: '' }));
          return;
        }
        applyJavaProjectConnection(result);
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'ready' : 'error', operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const openRecentJavaProject = useCallback(async (id) => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.openRecentJavaProject !== 'function') return;
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        applyJavaProjectConnection(await window.bordeauxAPI.openRecentJavaProject(id));
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'ready' : 'error', operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const refreshJavaProject = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.refreshJavaProject !== 'function') return;
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        applyJavaProjectConnection(await window.bordeauxAPI.refreshJavaProject());
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'stale' : 'error', operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const installJavaSupport = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.installJavaSupport !== 'function') return;
      setJavaProjectState((current) => ({ ...current, operation: 'install', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.installJavaSupport();
        if (result) {
          applyJavaProjectConnection(result);
          setJavaProjectState((current) => ({ ...current, notice: 'Support installed. Annotate command factories, follow .bordeaux/INTEGRATION.md for RobotContainer wiring, then build the catalog.' }));
        }
        else setJavaProjectState((current) => ({ ...current, operation: null }));
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const buildJavaCatalog = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.buildJavaCatalog !== 'function') return;
      setJavaProjectState((current) => ({ ...current, operation: 'build', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.buildJavaCatalog();
        if (result) {
          applyJavaProjectConnection(result);
          setJavaProjectState((current) => ({ ...current, notice: 'Generated command catalog built and loaded.' }));
        }
        else setJavaProjectState((current) => ({ ...current, operation: null }));
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, operation: null, status: current.catalog ? 'stale' : 'error', error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const cancelJavaCatalogBuild = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.cancelJavaCatalogBuild !== 'function') return;
      const result = await window.bordeauxAPI.cancelJavaCatalogBuild();
      setJavaProjectState((current) => ({ ...current, notice: result && result.canceled ? 'Canceling the Java catalog build…' : 'No Java catalog build is running.' }));
    }, []);

    // ---- Autonomous Routine ----
    const routine = project.routine || { name: 'Autonomous Routine', nodes: [] };
    const setRoutine = useCallback((update) => setProject((current) => {
      const value = typeof update === 'function' ? update(current.routine || { name: 'Autonomous Routine', nodes: [] }) : update;
      return { ...current, routine: value };
    }), []);
    const [routineOutcomes, setRoutineOutcomes] = useState({});
    const [routineTime, setRoutineTime] = useState(0);
    const [routinePlaying, setRoutinePlaying] = useState(false);
    const [routineSel, setRoutineSel] = useState(null);

    const robot = project.robot;
    const accent = ACCENT;

    const doc = project.paths[activeIdx];
    const docRef = useRef(doc); docRef.current = doc;
    const hist = useRef({ past: [], future: [] });
    const projectHist = useRef({ past: [], future: [] });
    const [, force] = useState(0);

    useEffect(() => {
      if (skipDirty.current) skipDirty.current = false;
      else setDirty(true);
    }, [project, plannerId]);
    useEffect(() => { if (window.bordeauxAPI) window.bordeauxAPI.setDirty(dirty); }, [dirty]);
    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.publishAgentSession !== 'function') return;
      agentRevision.current += 1;
      const revision = agentRevision.current;
      window.bordeauxAPI.publishAgentSession({
        sessionId: agentSessionId,
        revision,
        project: clone(project),
        plannerId,
        activePathId: doc.id,
        allianceView: alliance,
        fieldPack: { id: '2026-rebuilt', revision: '2026-manual-tu19-welded-4' },
      });
      setAgentProposal((current) => {
        if (!current || current.status !== 'ready' || current.baseRevision === revision) return current;
        window.bordeauxAPI.updateAgentProposalStatus(current.id, 'stale');
        return { ...current, status: 'stale' };
      });
    }, [project, plannerId, alliance, activeIdx, agentSessionId, doc.id]);
    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.onAgentProposal !== 'function') return;
      let active = true;
      let lastProposalKey = '';
      const receiveProposal = (proposal) => {
        if (!active || !proposal) return;
        const proposalKey = proposal.id + ':' + proposal.status;
        if (proposalKey === lastProposalKey) return;
        lastProposalKey = proposalKey;
        if (window.bordeauxAPI.acknowledgeAgentProposal) window.bordeauxAPI.acknowledgeAgentProposal(proposal.id);
        const stale = proposal.baseSessionId !== agentSessionId || proposal.baseRevision !== agentRevision.current;
        const received = stale && proposal.status === 'ready' ? { ...proposal, status: 'stale' } : proposal;
        if (stale && proposal.status === 'ready' && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(proposal.id, 'stale');
        setAgentProposal(received);
        setAgentCandidateId(proposal.recommendedCandidateId || null);
        setPage(proposal.operation === 'configureRobot' ? 'robot' : 'plan');
      };
      const unsubscribe = window.bordeauxAPI.onAgentProposal(receiveProposal);
      if (typeof window.bordeauxAPI.getActiveAgentProposal === 'function') {
        const restoreProposal = () => Promise.resolve(window.bordeauxAPI.getActiveAgentProposal()).then(receiveProposal).catch(() => undefined);
        restoreProposal();
        const restoreTimer = window.setInterval(restoreProposal, 1000);
        return () => { active = false; window.clearInterval(restoreTimer); unsubscribe(); };
      }
      return () => { active = false; unsubscribe(); };
    }, [agentSessionId]);
    useEffect(() => {
      const onPointerDown = () => { keyboardNavigation.current = false; };
      window.addEventListener('pointerdown', onPointerDown, true);
      return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, []);
    useEffect(() => {
      const pauseHiddenPlayback = () => {
        if (document.hidden) { setPlaying(false); setRoutinePlaying(false); }
      };
      document.addEventListener('visibilitychange', pauseHiddenPlayback);
      return () => document.removeEventListener('visibilitychange', pauseHiddenPlayback);
    }, []);

    // ---- derived path data ----
    const derived = useMemo(() => window.PM.derivePath(doc, robot, PERSEG, plannerId), [doc, robot, plannerId]);

    useEffect(() => { setTimes((t) => (t[doc.id] === derived.prof.totalTime ? t : { ...t, [doc.id]: derived.prof.totalTime })); }, [derived, doc.id]);

    // ---- doc mutation ----
    const writeDoc = useCallback((nd) => { setProject((pr) => { const paths = pr.paths.slice(); paths[activeIdx] = nd; return { ...pr, paths }; }); }, [activeIdx]);
    const beginHistory = useCallback(() => { hist.current.past.push(clone(docRef.current)); if (hist.current.past.length > 80) hist.current.past.shift(); hist.current.future = []; projectHist.current.future = []; force((x) => x + 1); }, []);
    const commit = useCallback((fn) => { beginHistory(); writeDoc(fn(clone(docRef.current))); }, [beginHistory, writeDoc]);
    const mutate = useCallback((fn) => { writeDoc(fn(clone(docRef.current))); }, [writeDoc]);

    const undo = useCallback(() => {
      const H = hist.current;
      if (H.past.length) { H.future.push(clone(docRef.current)); writeDoc(H.past.pop()); force((x) => x + 1); return; }
      const P = projectHist.current; if (!P.past.length) return;
      P.future.push({ project: clone(project), activeIdx });
      const previous = P.past.pop(); setProject(previous.project); setActiveIdx(previous.activeIdx); setSel({ kind: null, idx: -1 }); force((x) => x + 1);
    }, [writeDoc, project, activeIdx]);
    const redo = useCallback(() => {
      const H = hist.current;
      if (H.future.length) { H.past.push(clone(docRef.current)); writeDoc(H.future.pop()); force((x) => x + 1); return; }
      const P = projectHist.current; if (!P.future.length) return;
      P.past.push({ project: clone(project), activeIdx });
      const next = P.future.pop(); setProject(next.project); setActiveIdx(next.activeIdx); setSel({ kind: null, idx: -1 }); force((x) => x + 1);
    }, [writeDoc, project, activeIdx]);

    const select = useCallback((kind, idx) => setSel(kind ? { kind, idx } : { kind: null, idx: -1 }), []);
    const onSelPos = useCallback((p) => setSelPos(p), []);

    // ---- field actions ----
    const moveWaypoint = useCallback((i, p) => mutate((d) => {
      p = clampWorld(p);
      const w = d.waypoints[i]; const dx = p.x - w.x, dy = p.y - w.y;
      w.x = p.x; w.y = p.y; w.prevC.x += dx; w.prevC.y += dy; w.nextC.x += dx; w.nextC.y += dy; return d;
    }), [mutate]);
    const moveHandle = useCallback((i, which, p) => mutate((d) => {
      const w = d.waypoints[i]; const key = which ? 'nextC' : 'prevC'; const other = which ? 'prevC' : 'nextC';
      w[key] = { x: p.x, y: p.y };
      if (!w.stop && i > 0 && i < d.waypoints.length - 1) {
        const ol = Math.hypot(w[other].x - w.x, w[other].y - w.y);
        const ang = Math.atan2(p.y - w.y, p.x - w.x) + Math.PI;
        w[other] = { x: w.x + Math.cos(ang) * ol, y: w.y + Math.sin(ang) * ol };
        w.linked = true; w.corner = false;
      }
      return d;
    }), [mutate]);
    const prepareWaypointInsertion = useCallback((rawPoint, segmentHint, onPath, selectedVisit) => {
      const p = clampWorld(rawPoint);
      const candidate = clone(docRef.current);
      const wps = candidate.waypoints, oldCount = wps.length;
      const pts = derived.sample.pts || [];
      const f = selectedVisit && Number.isFinite(selectedVisit.f)
        ? selectedVisit.f
        : (pts.length > 1 ? window.PM.nearestFraction(p.x, p.y, pts) : 0.5);
      let segment = Number.isInteger(segmentHint) ? segmentHint : (selectedVisit && Number.isInteger(selectedVisit.seg) ? selectedVisit.seg : 0);
      if (!Number.isInteger(segmentHint) && derived.wpFrac && derived.wpFrac.length > 1) {
        for (let i = 0; i < derived.wpFrac.length - 1; i++) {
          if (f >= derived.wpFrac[i] - 1e-6) segment = i;
        }
      }
      segment = Math.max(0, Math.min(oldCount - 2, segment));
      const insertAt = segment + 1;
      const selectedT = selectedVisit && Number.isFinite(selectedVisit.t)
        ? selectedVisit.t
        : (derived.wpFrac && derived.wpFrac.length > segment + 1
          ? (f - derived.wpFrac[segment]) / Math.max(1e-9, derived.wpFrac[segment + 1] - derived.wpFrac[segment])
          : null);
      const nearest = onPath && selectedVisit && selectedVisit.seg === segment && Number.isFinite(selectedVisit.x) && Number.isFinite(selectedVisit.y)
        ? { x: selectedVisit.x, y: selectedVisit.y, t: selectedT, heading: selectedVisit.heading || 0 }
        : (onPath && pts.length > 1 ? window.PM.nearestPointOnSegment(p, pts, segment) : null);
      const projected = nearest || p;
      const originalType = (wps[segment] && wps[segment].segType) || 'bezier';
      const nw = { x: projected.x, y: projected.y, linked: true, thetaOn: false, theta: 0, stop: false, segType: originalType };
      if (wps[segment] && wps[segment].segmentHeadingMode) nw.segmentHeadingMode = wps[segment].segmentHeadingMode;
      if (wps[segment] && wps[segment].segmentLookAt) nw.segmentLookAt = { ...wps[segment].segmentLookAt };
      let previewRequired = false;

      // The original cubic planners can be split exactly with de Casteljau,
      // preserving the authored curve instead of reshaping both neighboring spans.
      if (onPath && originalType === 'bezier' && (plannerId === 'profiledSpline' || plannerId === 'optimizedTrajectory')) {
        const a = wps[segment], b = wps[segment + 1], t = nearest && Number.isFinite(nearest.t) ? Math.max(0.001, Math.min(0.999, nearest.t)) : 0.5;
        if (a && b && a.nextC && b.prevC) {
          const split = window.PM.splitBezier(a, a.nextC, b.prevC, b, t);
          nw.x = split.point.x; nw.y = split.point.y; nw.prevC = split.left[2]; nw.nextC = split.right[1];
          a.nextC = split.left[1]; b.prevC = split.right[2];
        }
      } else if (onPath && (originalType === 'arc' || originalType === 'clothoid') && nearest) {
        // These segment solvers are endpoint/tangent based. Seed both sides with
        // the measured tangent, then require a preview because adding the joint
        // can make the solver choose a different valid construction.
        const a = wps[segment], b = wps[segment + 1];
        const handle = Math.max(0.15, Math.min(Math.hypot(nw.x - a.x, nw.y - a.y), Math.hypot(b.x - nw.x, b.y - nw.y)) / 3);
        nw.prevC = { x: nw.x - Math.cos(nearest.heading) * handle, y: nw.y - Math.sin(nearest.heading) * handle };
        nw.nextC = { x: nw.x + Math.cos(nearest.heading) * handle, y: nw.y + Math.sin(nearest.heading) * handle };
        previewRequired = true;
      }

      wps.splice(insertAt, 0, nw);
      remapWaypointRanges(candidate, Array.from({ length: oldCount }, (_, index) => index < insertAt ? index : index + 1));
      if (!nw.prevC || !nw.nextC) {
        const hd = window.PM.autoHandles(wps, insertAt);
        nw.prevC = hd.prevC; nw.nextC = hd.nextC;
      }
      candidate._selAfter = insertAt;
      return { doc: candidate, index: insertAt, previewRequired, segmentType: originalType };
    }, [derived, plannerId]);

    const addWaypoint = useCallback((p, segmentHint, onPath, selectedVisit) => {
      const prepared = prepareWaypointInsertion(p, segmentHint, onPath, selectedVisit);
      const compatibility = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
      if (compatibility || prepared.previewRequired) {
        try {
          const previewDerived = window.PM.derivePath(prepared.doc, robot, PERSEG, plannerId);
          const message = compatibility
            ? (plannerId === 'labviewClothoid' ? 'A new clothoid vertex rebuilds the neighboring turn.' : 'Compatibility geometry changes are shown before they are applied.')
            : 'Splitting this ' + prepared.segmentType + ' may rebuild its geometry. Review the dashed path first.';
          setWaypointPreview({ ...prepared, derived: previewDerived, plannerId, message });
        } catch (error) {
          console.error('Could not preview waypoint insertion:', error);
        }
        return;
      }
      commit(() => prepared.doc);
    }, [commit, plannerId, prepareWaypointInsertion, robot]);
    const appendWaypoint = useCallback((rawPoint) => {
      const point = clampWorld(rawPoint);
      const candidate = clone(docRef.current);
      const wps = candidate.waypoints, oldCount = wps.length;
      const end = wps[oldCount - 1], before = wps[oldCount - 2] || end;
      const dx = point.x - end.x, dy = point.y - end.y, distance = Math.hypot(dx, dy);
      if (distance < 0.05) return;

      const ux = dx / distance, uy = dy / distance;
      const incomingX = end.prevC ? end.x - end.prevC.x : end.x - before.x;
      const incomingY = end.prevC ? end.y - end.prevC.y : end.y - before.y;
      const incomingLength = Math.hypot(incomingX, incomingY);
      const tx = !end.stop && incomingLength > 1e-6 ? incomingX / incomingLength : ux;
      const ty = !end.stop && incomingLength > 1e-6 ? incomingY / incomingLength : uy;
      const handle = Math.max(0.15, distance / 3);
      const segmentType = end.segType || before.segType || 'bezier';
      const endpointJiggle = end.jiggle ? { ...end.jiggle } : null;
      delete end.jiggle;
      end.segType = segmentType;
      if (before.segmentHeadingMode) end.segmentHeadingMode = before.segmentHeadingMode;
      else delete end.segmentHeadingMode;
      if (before.segmentLookAt) end.segmentLookAt = { ...before.segmentLookAt };
      else delete end.segmentLookAt;
      end.nextC = { x: end.x + tx * handle, y: end.y + ty * handle };
      if (!end.stop) { end.linked = true; end.corner = false; }

      const next = {
        x: point.x, y: point.y,
        prevC: { x: point.x - ux * handle, y: point.y - uy * handle },
        nextC: { x: point.x + ux * handle, y: point.y + uy * handle },
        linked: true, thetaOn: true, theta: end.theta || 0, stop: false,
      };
      if (endpointJiggle) next.jiggle = endpointJiggle;
      wps.push(next);
      remapWaypointRanges(candidate, Array.from({ length: oldCount }, (_, index) => index));
      candidate._selAfter = oldCount;

      const compatibility = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
      if (compatibility || segmentType === 'clothoid') {
        try {
          const previewDerived = window.PM.derivePath(candidate, robot, PERSEG, plannerId);
          const message = compatibility
            ? 'The new endpoint and compatibility geometry are shown before they are applied.'
            : 'The new clothoid join may rebuild the previous turn. Review the dashed path first.';
          setWaypointPreview({ doc: candidate, index: oldCount, derived: previewDerived, plannerId, message, actionLabel: 'Place endpoint' });
        } catch (error) {
          console.error('Could not preview waypoint placement:', error);
        }
        return;
      }
      commit(() => candidate);
    }, [commit, plannerId, robot]);
    const setJiggle = useCallback((options) => {
      if (!options) {
        commit((d) => { delete d.waypoints[d.waypoints.length - 1].jiggle; return d; });
        return true;
      }
      const config = {
        distanceM: Math.max(0.03, Math.min(1.5, Number(options.distanceM))),
        strokes: Math.max(2, Math.min(12, Math.round(Number(options.strokes)))),
        startDeg: Number(options.startDeg),
        stepDeg: Number(options.stepDeg),
        strokeTimeS: Math.max(0.08, Math.min(5, Number(options.strokeTimeS))),
      };
      if (!Object.values(config).every(Number.isFinite)) return false;
      const anchor = docRef.current.waypoints[docRef.current.waypoints.length - 1];
      const lastIndex = Math.max(0, (derived.wpIdx && derived.wpIdx[docRef.current.waypoints.length - 1]) || 0);
      const baseRad = anchor.turnInPlace
        ? anchor.turnInPlace.headingDeg * Math.PI / 180
        : derived.metrics && derived.metrics.head ? derived.metrics.head[lastIndex] : (anchor.theta || 0) * Math.PI / 180;
      const physicalBaseRad = baseRad + (derived.rev ? Math.PI : 0);
      if (!window.PM.jigglePositions(anchor, physicalBaseRad, config, { w: FIELD_W, h: FIELD_H })) return false;
      commit((d) => {
        d.waypoints[d.waypoints.length - 1].jiggle = config;
        d.goalVel = 0;
        return d;
      });
      return true;
    }, [commit, derived]);
    const applyWaypointPreview = useCallback(() => {
      if (!waypointPreview) return;
      commit(() => waypointPreview.doc);
      setWaypointPreview(null);
    }, [commit, waypointPreview]);
    useEffect(() => { setWaypointPreview(null); }, [doc, plannerId]);
    useEffect(() => { if (doc._selAfter != null) { select('wp', doc._selAfter); mutate((d) => { delete d._selAfter; return d; }); } }, [doc._selAfter]);

    const setWp = useCallback((i, patch) => commit((d) => {
      const w = d.waypoints[i];
      if (patch.x != null || patch.y != null) {
        const next = clampWorld({ x: patch.x != null ? patch.x : w.x, y: patch.y != null ? patch.y : w.y });
        patch = { ...patch, x: next.x, y: next.y };
      }
      Object.assign(w, patch); return d;
    }), [commit]);
    const toggleStop = useCallback((i, on) => commit((d) => { const w = d.waypoints[i]; w.stop = on; if (on) w.linked = false; else { alignWaypointHandles(w); delete w.wait; delete w.turnInPlace; } return d; }), [commit]);
    const toggleTheta = useCallback((i, on) => commit((d) => { d.waypoints[i].thetaOn = on; return d; }), [commit]);
    const setHandleLen = useCallback((i, key, len) => commit((d) => { const w = d.waypoints[i]; const a = Math.atan2(w[key].y - w.y, w[key].x - w.x); w[key] = { x: w.x + Math.cos(a) * len, y: w.y + Math.sin(a) * len }; return d; }), [commit]);
    const delWp = useCallback((i) => { commit((d) => {
      if (d.waypoints.length <= 2 || i < 0 || i >= d.waypoints.length) return d;
      const oldCount = d.waypoints.length;
      const endpointJiggle = i === oldCount - 1 && d.waypoints[i].jiggle ? { ...d.waypoints[i].jiggle } : null;
      const indexMap = Array.from({ length: oldCount }, (_, index) => index === i ? null : index < i ? index : index - 1);
      d.waypoints.splice(i, 1);
      const last = d.waypoints.length - 1;
      remapWaypointRanges(d, indexMap, i);
      delete d.waypoints[last].segmentHeadingMode;
      delete d.waypoints[last].segmentLookAt;
      delete d.waypoints[0].headingTransition;
      delete d.waypoints[last].headingTransition;
      if (endpointJiggle) d.waypoints[last].jiggle = endpointJiggle;
      d.waypoints[0].thetaOn = true; d.waypoints[last].thetaOn = true;
      return d;
    }); select(null, -1); }, [commit, select]);

    const enableTargetsAtFraction = (d, f) => {
      const fractions = derived.wpFrac || window.PM.waypointFracs(d, derived.sample);
      let segment = 0;
      for (let i = 0; i < d.waypoints.length - 1; i++) {
        if (f >= (fractions[i] || 0) - 1e-6) segment = i;
      }
      segment = Math.max(0, Math.min(d.waypoints.length - 2, segment));
      d.waypoints[segment].segmentHeadingMode = 'targets';
    };
    const addTargetAt = useCallback((p, visitFraction) => commit((d) => {
      const pts = derived.sample.pts;
      const f = Number.isFinite(visitFraction) ? visitFraction : (pts.length > 1 ? window.PM.nearestFraction(p.x, p.y, pts) : 0.5);
      const deg = pts.length > 1 ? window.PM.pointAtFraction(f, pts).heading * 180 / Math.PI : 0;
      d.targets.push({ f, deg });
      enableTargetsAtFraction(d, f);
      d._selT = d.targets.length - 1;
      return d;
    }), [commit, derived]);
    const addMarkerAt = useCallback((p, visitFraction) => commit((d) => { const f = Number.isFinite(visitFraction) ? visitFraction : (derived.sample.pts.length > 1 ? window.PM.nearestFraction(p.x, p.y, derived.sample.pts) : 0.5); d.markers.push({ id: markerId(), f, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit, derived]);
    useEffect(() => { if (doc._selT != null) { select('rt', doc._selT); mutate((d) => { delete d._selT; return d; }); } }, [doc._selT]);
    useEffect(() => { if (doc._selM != null) { select('em', doc._selM); mutate((d) => { delete d._selM; return d; }); } }, [doc._selM]);

    const moveTargetTo = useCallback((i, p, visitFraction) => mutate((d) => { const t = d.targets[i]; if (!t) return d; const f = Number.isFinite(visitFraction) ? visitFraction : window.PM.nearestFraction(p.x, p.y, derived.sample.pts); t.f = f; if (t.anchor === 'dist') t.d = +(f * (derived.sample.length || 0)).toFixed(3); return d; }), [mutate, derived]);
    const rotateTargetTo = useCallback((i, p, snap) => mutate((d) => {
      const target = d.targets[i]; if (!target) return d;
      const f = window.PM.featureFraction(target, derived.sample);
      const center = window.PM.pointAtFraction(f, derived.sample.pts);
      let deg = Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI;
      if (snap) deg = Math.round(deg / 15) * 15;
      target.deg = Math.round(deg * 10) / 10;
      return d;
    }), [mutate, derived]);
    const moveMarkerTo = useCallback((i, p, visitFraction) => mutate((d) => { const m = d.markers[i]; if (!m) return d; const f = Number.isFinite(visitFraction) ? visitFraction : window.PM.nearestFraction(p.x, p.y, derived.sample.pts); m.f = f; if (m.anchor === 'dist') m.d = +(f * (derived.sample.length || 0)).toFixed(3); return d; }), [mutate, derived]);
    const setFeature = (items, i, patch) => { const item = items[i]; if (!item) return; if (patch.anchor) { const f = window.PM.featureFraction(item, derived.sample); item.f = f; if (patch.anchor === 'dist') item.d = +(f * (derived.sample.length || 0)).toFixed(3); else delete item.d; } Object.assign(item, patch); };
    const setTarget = useCallback((i, patch) => commit((d) => { setFeature(d.targets, i, patch); return d; }), [commit, derived]);
    const delTarget = useCallback((i) => { commit((d) => { d.targets.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);
    const setMarker = useCallback((i, patch) => commit((d) => { setFeature(d.markers, i, patch); return d; }), [commit, derived]);
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
    const localRangeEndpoint = (fraction, fractions) => {
      const f = Math.max(0, Math.min(1, fraction));
      let segment = Math.max(0, fractions.length - 2);
      for (let i = 0; i < fractions.length - 1; i++) {
        if (f <= fractions[i + 1] + 1e-9) { segment = i; break; }
      }
      const lo = fractions[segment] || 0, hi = fractions[segment + 1] != null ? fractions[segment + 1] : lo;
      return { waypoint: segment, local: hi > lo ? Math.max(0, Math.min(1, (f - lo) / (hi - lo))) : 0 };
    };
    const setRangeAnchor = useCallback((i, anchor) => commit((d) => {
      const range = d.ranges[i]; if (!range) return d;
      const effective = (derived.effRanges && derived.effRanges[i]) || range;
      const f0 = effective.f0 || 0, f1 = effective.f1 || 0;
      range.f0 = f0; range.f1 = f1; range.anchor = anchor;
      if (anchor === 'dist') {
        const length = derived.sample.length || 0;
        range.d0 = +(f0 * length).toFixed(3); range.d1 = +(f1 * length).toFixed(3);
        delete range.w0; delete range.w1; delete range.t0; delete range.t1;
      } else if (anchor === 'wp') {
        const fractions = window.PM.waypointFracs(d, derived.sample);
        const start = localRangeEndpoint(f0, fractions), end = localRangeEndpoint(f1, fractions);
        range.w0 = start.waypoint; range.t0 = start.local; range.w1 = end.waypoint; range.t1 = end.local;
        delete range.d0; delete range.d1;
      } else {
        delete range.d0; delete range.d1; delete range.w0; delete range.w1; delete range.t0; delete range.t1;
      }
      return d;
    }), [commit, derived]);
    const delRange = useCallback((i) => { commit((d) => { d.ranges.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);
    const moveRangeHandle = useCallback((i, which, f) => mutate((d) => {
      const rg = d.ranges[i]; const key = which ? 'f1' : 'f0'; const cf = Math.max(0, Math.min(1, f));
      const len = derived.sample.length || 1;
      if (rg.anchor === 'dist') { rg[which ? 'd1' : 'd0'] = +(cf * len).toFixed(2); }
      else if (rg.anchor === 'wp') {
        const wf = window.PM.waypointFracs(d, derived.sample);
        const local = localRangeEndpoint(cf, wf);
        rg[which ? 'w1' : 'w0'] = local.waypoint; rg[which ? 't1' : 't0'] = local.local;
      }
      else { rg[key] = cf; }
      return d;
    }), [mutate, derived]);
    useEffect(() => { if (doc._selR != null) { select('cr', doc._selR); mutate((d) => { delete d._selR; return d; }); } }, [doc._selR]);

    const setConstraint = useCallback((patch) => commit((d) => { Object.assign(d.constraints, patch); return d; }), [commit]);
    const setDoc = useCallback((patch) => commit((d) => Object.assign(d, patch)), [commit]);
    const rename = useCallback((nm) => mutate((d) => { d.name = nm; return d; }), [mutate]);
    const setRobot = useCallback((patch) => setProject((pr) => ({ ...pr, robot: { ...pr.robot, ...patch } })), []);

    // ---- modeless “add” actions: create + select, then edit on canvas / inspector ----
    const addTargetMid = useCallback(() => commit((d) => {
      const pts = derived.sample.pts;
      const deg = pts.length > 1 ? window.PM.pointAtFraction(0.5, pts).heading * 180 / Math.PI : 0;
      d.targets.push({ f: 0.5, deg });
      enableTargetsAtFraction(d, 0.5);
      d._selT = d.targets.length - 1;
      return d;
    }), [commit, derived]);
    const addMarkerMid = useCallback(() => commit((d) => { d.markers.push({ id: markerId(), f: 0.5, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit]);
    const addRangeMid = useCallback(() => addRange(0.35, 0.6), [addRange]);

    // ---- segment + waypoint structural ops (memo §3 / §4 / §7 / §8) ----
    const PX = { X0: 397, X1: 3502, Y0: 97, Y1: 1486 };
    const setSegMeta = useCallback((i, patch) => commit((d) => { Object.assign(d.waypoints[i], patch); return d; }), [commit]);
    const setSegmentHeadingMode = useCallback((i, mode) => commit((d) => {
      const w = d.waypoints[i], next = d.waypoints[i + 1];
      if (mode === 'inherit') delete w.segmentHeadingMode;
      else w.segmentHeadingMode = mode;
      if (mode === 'lookAt' && !w.segmentLookAt && next) {
        const dx = next.x - w.x, dy = next.y - w.y, length = Math.hypot(dx, dy) || 1;
        w.segmentLookAt = clampWorld({ x: (w.x + next.x) / 2 - dy / length * 1.25, y: (w.y + next.y) / 2 + dx / length * 1.25 });
      }
      return d;
    }), [commit]);
    const setHeadingTransition = useCallback((i, patch) => commit((d) => {
      const w = d.waypoints[i]; if (!w || i <= 0 || i >= d.waypoints.length - 1) return d;
      w.headingTransition = Object.assign({ placement: 'after', rotationPriority: 'heading', distanceM: 0.75 }, w.headingTransition || {}, patch);
      return d;
    }), [commit]);
    const setSegmentLookAt = useCallback((i, patch) => commit((d) => {
      const w = d.waypoints[i]; if (!w) return d;
      w.segmentLookAt = clampWorld({ x: patch.x != null ? patch.x : w.segmentLookAt.x, y: patch.y != null ? patch.y : w.segmentLookAt.y });
      return d;
    }), [commit]);
    const moveSegmentLookAt = useCallback((i, point) => mutate((d) => {
      const w = d.waypoints[i]; if (w) w.segmentLookAt = clampWorld(point); return d;
    }), [mutate]);
    const setStop = useCallback((i, on) => commit((d) => { const w = d.waypoints[i]; w.stop = on; if (on) { w.linked = false; } else { alignWaypointHandles(w); delete w.wait; delete w.turnInPlace; } return d; }), [commit]);
    const setWait = useCallback((i, sec) => commit((d) => { d.waypoints[i].wait = Math.max(0, sec); return d; }), [commit]);
    const setTurnInPlace = useCallback((i, on) => commit((d) => {
      const w = d.waypoints[i]; if (!w) return d;
      if (!on) delete w.turnInPlace;
      else {
        const sampleIndex = Math.max(0, ((derived.wpIdx && derived.wpIdx[i]) || 0) - (i > 0 ? 1 : 0));
        const arrival = derived.metrics && derived.metrics.head ? derived.metrics.head[sampleIndex] * 180 / Math.PI : (w.theta || 0);
        const headingDeg = Math.round(arrival + 90);
        w.turnInPlace = { headingDeg, direction: 'shortest' };
        w.stop = true; w.linked = false;
        if (i < d.waypoints.length - 1) { w.theta = headingDeg; w.thetaOn = true; w.segmentHeadingMode = 'manual'; }
      }
      return d;
    }), [commit, derived]);
    const setTurnInPlaceMeta = useCallback((i, patch) => commit((d) => {
      const w = d.waypoints[i]; if (!w || !w.turnInPlace) return d;
      Object.assign(w.turnInPlace, patch);
      if (patch.headingDeg != null && i < d.waypoints.length - 1) { w.theta = patch.headingDeg; w.thetaOn = true; w.segmentHeadingMode = 'manual'; }
      return d;
    }), [commit]);
    const setHeadingMode = useCallback((m) => commit((d) => { d.headingMode = m; return d; }), [commit]);
    const toggleDriveBackward = useCallback(() => commit((d) => { d.driveBackward = !d.driveBackward; return d; }), [commit]);
    const nudgeWp = useCallback((i, dx, dy) => commit((d) => { const w = d.waypoints[i]; if (!w) return d; const nx = Math.max(0, Math.min(FIELD_W, w.x + dx)), ny = Math.max(0, Math.min(FIELD_H, w.y + dy)); const ddx = nx - w.x, ddy = ny - w.y; w.x = nx; w.y = ny; if (w.prevC) { w.prevC.x += ddx; w.prevC.y += ddy; } if (w.nextC) { w.nextC.x += ddx; w.nextC.y += ddy; } return d; }), [commit]);
    const nudgeFrac = useCallback((kind, i, df) => commit((d) => {
      const arr = kind === 'rt' ? d.targets : d.markers; const item = arr[i]; if (!item) return d;
      const f = Math.max(0, Math.min(1, window.PM.featureFraction(item, derived.sample) + df));
      item.f = f; if (item.anchor === 'dist') item.d = +(f * (derived.sample.length || 0)).toFixed(3);
      return d;
    }), [commit, derived]);
    const setWaypointHeading = useCallback((i, deg) => mutate((d) => { const w = d.waypoints[i]; w.theta = deg; w.thetaOn = true; return d; }), [mutate]);
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
      const oldCount = d.waypoints.length;
      const src = JSON.parse(JSON.stringify(d.waypoints[i]));
      delete src.headingTransition;
      if (i === oldCount - 1) delete d.waypoints[i].jiggle;
      else delete src.jiggle;
      const next = clampWorld({ x: src.x + 0.4, y: src.y + 0.4 }); src.x = next.x; src.y = next.y;
      d.waypoints.splice(i + 1, 0, src);
      remapWaypointRanges(d, Array.from({ length: oldCount }, (_, index) => index <= i ? index : index + 1));
      const hd = window.PM.autoHandles(d.waypoints, i + 1); src.prevC = hd.prevC; src.nextC = hd.nextC;
      d.waypoints[0].thetaOn = true; d.waypoints[d.waypoints.length - 1].thetaOn = true;
      d._selAfter = i + 1; return d;
    }), [commit]);
    const reversePath = useCallback(() => commit((d) => {
      const endpointJiggle = d.waypoints[d.waypoints.length - 1].jiggle ? { ...d.waypoints[d.waypoints.length - 1].jiggle } : null;
      const oldSeg = d.waypoints.map((w) => w.segType);
      const oldHeading = d.waypoints.map((w) => w.segmentHeadingMode);
      const oldLookAt = d.waypoints.map((w) => w.segmentLookAt && { ...w.segmentLookAt });
      const oldLaws = d.waypoints.slice(0, -1).map((waypoint) => {
        const mode = waypoint.segmentHeadingMode || d.headingMode || 'targets';
        return mode === 'lookAt' ? 'lookAt:' + (waypoint.segmentLookAt ? waypoint.segmentLookAt.x + ':' + waypoint.segmentLookAt.y : '') : mode;
      });
      const oldTransitions = d.waypoints.map((waypoint, index) => index > 0 && index < d.waypoints.length - 1
        && oldLaws[index] !== oldLaws[index - 1] && !waypoint.turnInPlace
        ? { placement: 'after', rotationPriority: 'heading', distanceM: 0.75, ...(waypoint.headingTransition || {}) }
        : null);
      const w = d.waypoints.slice().reverse(); const n = w.length;
      w.forEach((x) => {
        const p = x.prevC; x.prevC = x.nextC; x.nextC = p;
        if (x.turnInPlace && x.turnInPlace.direction === 'clockwise') x.turnInPlace.direction = 'counterclockwise';
        else if (x.turnInPlace && x.turnInPlace.direction === 'counterclockwise') x.turnInPlace.direction = 'clockwise';
      });
      for (let j = 0; j < n; j++) {
        if (j < n - 1) {
          w[j].segType = oldSeg[n - 2 - j];
          if (oldHeading[n - 2 - j]) w[j].segmentHeadingMode = oldHeading[n - 2 - j];
          else delete w[j].segmentHeadingMode;
          if (oldLookAt[n - 2 - j]) w[j].segmentLookAt = { ...oldLookAt[n - 2 - j] };
          else delete w[j].segmentLookAt;
        } else {
          delete w[j].segType;
          delete w[j].segmentHeadingMode;
          delete w[j].segmentLookAt;
        }
        delete w[j].headingTransition;
      }
      for (let oldIndex = 1; oldIndex < n - 1; oldIndex++) {
        const transition = oldTransitions[oldIndex]; if (!transition) continue;
        const newIndex = n - 1 - oldIndex;
        w[newIndex].headingTransition = { ...transition,
          placement: transition.placement === 'before' ? 'after' : transition.placement === 'split' ? 'split' : 'before' };
      }
      d.waypoints = w; remapWaypointRanges(d, Array.from({ length: n }, (_, index) => n - 1 - index));
      w.forEach((waypoint) => delete waypoint.jiggle);
      if (endpointJiggle) w[n - 1].jiggle = endpointJiggle;
      const sv = d.startVel, gv = d.goalVel; d.startVel = gv; d.goalVel = sv;
      if (endpointJiggle) d.goalVel = 0;
      w[0].thetaOn = true; w[n - 1].thetaOn = true; return d;
    }), [commit]);
    const reorderWp = useCallback((from, to) => commit((d) => {
      const w = d.waypoints; if (to < 0 || to >= w.length || from === to) return d;
      const endpointJiggle = w[w.length - 1].jiggle ? { ...w[w.length - 1].jiggle } : null;
      const order = Array.from({ length: w.length }, (_, index) => index);
      const [oldIndex] = order.splice(from, 1); order.splice(to, 0, oldIndex);
      const indexMap = []; order.forEach((value, index) => { indexMap[value] = index; });
      const [m] = w.splice(from, 1); w.splice(to, 0, m);
      w.forEach((waypoint) => delete waypoint.jiggle);
      if (endpointJiggle) w[w.length - 1].jiggle = endpointJiggle;
      delete w[w.length - 1].segmentHeadingMode;
      delete w[w.length - 1].segmentLookAt;
      delete w[0].headingTransition;
      delete w[w.length - 1].headingTransition;
      remapWaypointRanges(d, indexMap);
      w[0].thetaOn = true; w[w.length - 1].thetaOn = true; d._selAfter = to; return d;
    }), [commit]);
    const insertWp = useCallback((i) => {
      const pts = derived.sample.pts;
      if (!pts || pts.length < 2) return;
      const lo = derived.wpFrac && Number.isFinite(derived.wpFrac[i]) ? derived.wpFrac[i] : i / Math.max(1, doc.waypoints.length - 1);
      const hi = derived.wpFrac && Number.isFinite(derived.wpFrac[i + 1]) ? derived.wpFrac[i + 1] : (i + 1) / Math.max(1, doc.waypoints.length - 1);
      addWaypoint(window.PM.pointAtFraction((lo + hi) / 2, pts), i, true);
    }, [addWaypoint, derived, doc.waypoints.length]);
    const zoomToFraction = useCallback((f) => {
      const pts = derived.sample.pts; if (!pts || pts.length < 2) return;
      const p = window.PM.pointAtFraction(f, pts);
      const sx = (PX.X1 - PX.X0) / FIELD_W, sy = (PX.Y1 - PX.Y0) / FIELD_H;
      const q = alliance === 'red' ? { x: FIELD_W - p.x, y: FIELD_H - p.y } : p;
      const cx = PX.X0 + q.x * sx, cy = PX.Y1 - q.y * sy;
      const nw = IMG_W * 0.42, nh = nw * (IMG_H / IMG_W);
      setView({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
    }, [derived, alliance]);
    const pickCheck = useCallback((check) => { select('seg', check.seg); zoomToFraction(check.f); setDiagOpen(true); }, [select, zoomToFraction]);

    const inspActions = { setWp, toggleStop, toggleTheta, setHandleLen, delWp, setTarget, delTarget, setMarker, delMarker, setRange, setRangeAnchor, delRange, setConstraint, setDoc, rename, select, setTool,
      addTargetMid, addMarkerMid, addRangeMid,
      setSegMeta, setSegmentHeadingMode, setHeadingTransition, setSegmentLookAt, setJiggle, faceWaypoint, duplicateWp, reversePath, reorderWp, insertWp,
      setStop, setWait, setTurnInPlace, setTurnInPlaceMeta, setHeadingMode, toggleDriveBackward,
      openInspector: () => setInspectorOpen(true) };
    const fieldActions = { addWaypoint, appendWaypoint, moveWaypoint, moveHandle, addTargetAt, addMarkerAt, moveTargetTo, rotateTargetTo, moveMarkerTo, addRange, moveRangeHandle, beginHistory,
      setWaypointHeading, moveSegmentLookAt, headingMenu, faceWaypoint, delWp, delTarget, delMarker, delRange,
      openInspector: () => setInspectorOpen(true),
      select };

    // ---- project ops ----
    const uniquePathName = (base) => {
      const used = new Set(project.paths.map((path) => path.name.toLowerCase()));
      if (!used.has(base.toLowerCase())) return base;
      let suffix = 2;
      while (used.has((base + ' ' + suffix).toLowerCase())) suffix++;
      return base + ' ' + suffix;
    };
    const resetForPath = (i) => {
      setActiveIdx(i); setSel({ kind: null, idx: -1 }); setPlayTime(0); setPlaying(false);
      hist.current = { past: [], future: [] }; setPage('plan');
    };
    const addPath = (folderId) => {
      const name = uniquePathName('New path'), index = project.paths.length;
      const path = blankPath(name); if (folderId) path.folderId = folderId;
      setProject((pr) => ({ ...pr, paths: [...pr.paths, path] })); resetForPath(index);
      return { index, name, id: path.id };
    };
    const dupPath = (i) => {
      const source = project.paths[i]; if (!source) return null;
      const name = uniquePathName(source.name + ' copy'), index = i + 1;
      setProject((pr) => { const cp = clone(pr.paths[i]); cp.id = pathId(); cp.name = name; const paths = pr.paths.slice(); paths.splice(index, 0, cp); return { ...pr, paths }; });
      resetForPath(index); return { index, name, id: null };
    };
    const delPath = (i) => {
      if (project.paths.length <= 1) return false;
      const target = project.paths[i]; let referenced = false;
      window.AUTO.walk(routine.nodes, (node) => { if (node.type === 'path' && node.ref === target.id) referenced = true; });
      if (referenced) { alert('“' + target.name + '” is used by the autonomous routine. Remove that routine step before deleting the path.'); return false; }
      if (!confirm('Delete path “' + target.name + '”? This cannot be undone.')) return false;
      setProject((pr) => { const paths = pr.paths.filter((_, k) => k !== i); return { ...pr, paths }; });
      setActiveIdx((a) => Math.max(0, a > i ? a - 1 : a === i ? Math.min(a, project.paths.length - 2) : a));
      setSel({ kind: null, idx: -1 }); setPlayTime(0); setPlaying(false); hist.current = { past: [], future: [] };
      return true;
    };
    const renamePath = (i, name) => { const clean = (name || '').trim(); if (!clean) return false; setProject((pr) => { const paths = pr.paths.slice(); paths[i] = { ...paths[i], name: clean }; return { ...pr, paths }; }); return true; };
    const addPathFolder = () => {
      const folders = project.pathFolders || [], used = new Set(folders.map((folder) => folder.name.toLowerCase()));
      let name = 'New folder', suffix = 2; while (used.has(name.toLowerCase())) name = 'New folder ' + suffix++;
      const folder = { id: 'folder_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)), name };
      setProject((pr) => ({ ...pr, pathFolders: [...(pr.pathFolders || []), folder] }));
      return folder;
    };
    const renamePathFolder = (id, name) => {
      const clean = (name || '').trim(); if (!clean) return false;
      setProject((pr) => ({ ...pr, pathFolders: (pr.pathFolders || []).map((folder) => folder.id === id ? { ...folder, name: clean } : folder) })); return true;
    };
    const deletePathFolder = (id) => {
      const folder = (project.pathFolders || []).find((candidate) => candidate.id === id); if (!folder) return false;
      const count = project.paths.filter((path) => path.folderId === id).length;
      if (!confirm('Delete folder “' + folder.name + '”?' + (count ? ' Its ' + count + ' path' + (count === 1 ? '' : 's') + ' will move to Unfiled.' : ''))) return false;
      setProject((pr) => ({ ...pr, pathFolders: (pr.pathFolders || []).filter((candidate) => candidate.id !== id), paths: pr.paths.map((path) => path.folderId === id ? (() => { const next = { ...path }; delete next.folderId; return next; })() : path) }));
      return true;
    };
    const movePathToFolder = (i, folderId) => setProject((pr) => ({ ...pr, paths: pr.paths.map((path, index) => {
      if (index !== i) return path; const next = { ...path }; if (folderId) next.folderId = folderId; else delete next.folderId; return next;
    }) }));
    const setActive = (i) => resetForPath(i);
    const agentCandidates = agentProposal && Array.isArray(agentProposal.candidates) ? agentProposal.candidates : [];
    const agentCandidate = agentCandidates.find((candidate) => candidate.id === agentCandidateId) || agentCandidates[0] || null;
    const agentProposalPreviews = useMemo(() => agentCandidates.flatMap((candidate) => {
      if (!candidate.path) return [];
      try { return [{ id: candidate.id, label: candidate.label, selected: candidate.id === (agentCandidate && agentCandidate.id), valid: candidate.valid !== false, derived: window.PM.derivePath(candidate.path, robot, PERSEG, plannerId) }]; }
      catch (_) { return []; }
    }), [agentProposal, agentCandidateId, robot, plannerId]);
    const rejectAgentProposal = useCallback(() => {
      if (!agentProposal) return;
      if (window.bordeauxAPI && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(agentProposal.id, 'rejected');
      setAgentProposal({ ...agentProposal, status: 'rejected' });
    }, [agentProposal]);
    const applyAgentProposal = useCallback(() => {
      if (!agentProposal || agentProposal.status !== 'ready' || agentProposal.baseSessionId !== agentSessionId || agentProposal.baseRevision !== agentRevision.current || (agentProposal.blockingIssues && agentProposal.blockingIssues.length)) return;
      const before = { project: clone(project), activeIdx };
      let nextIndex = activeIdx;
      let nextProject;
      if (agentProposal.operation === 'configureRobot') {
        if (!agentProposal.planning) return;
        nextProject = { ...project, robot: { ...project.robot, planning: clone(agentProposal.planning) } };
      } else if (!agentCandidate || agentCandidate.valid === false || !agentCandidate.path) return;
      else if (agentProposal.operation === 'replace') {
        nextIndex = project.paths.findIndex((path) => path.id === agentProposal.targetPathId);
        if (nextIndex < 0) return;
        const replacement = clone(agentCandidate.path); replacement.id = project.paths[nextIndex].id;
        const paths = project.paths.slice(); paths[nextIndex] = replacement; nextProject = { ...project, paths };
      } else {
        nextIndex = project.paths.length;
        nextProject = { ...project, paths: [...project.paths, clone(agentCandidate.path)] };
      }
      projectHist.current.past.push(before); if (projectHist.current.past.length > 80) projectHist.current.past.shift(); projectHist.current.future = [];
      setProject(nextProject); if (agentProposal.operation !== 'configureRobot') resetForPath(nextIndex); setDirty(true);
      if (window.bordeauxAPI && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(agentProposal.id, 'applied', agentRevision.current + 1);
      setAgentProposal({ ...agentProposal, status: 'applied', appliedRevision: agentRevision.current + 1 });
    }, [agentProposal, agentCandidate, project, activeIdx, agentSessionId]);

    // ---- playback loop ----
    const total = derived.prof.totalTime || 0;
    const totalRef = useRef(0); totalRef.current = total;
    const playRef = useRef(0); playRef.current = playTime;
    const togglePlayback = useCallback(() => {
      const totalNow = totalRef.current;
      if (playRef.current >= totalNow - 1e-3) { setPlayTime(0); setPlaying(true); }
      else setPlaying((value) => !value);
    }, []);
    useEffect(() => {
      if (!playing) return; let raf, last = performance.now();
      const tick = (now) => { const dt = (now - last) / 1000; last = now; setPlayTime((t) => { let nt = t + dt; if (nt >= total) { nt = total; setPlaying(false); } return nt; }); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    }, [playing, total]);
    useEffect(() => { if (playTime > total) setPlayTime(total); }, [total]);
    const restart = () => { setPlayTime(0); setPlaying(true); };
    const seek = (t) => { setPlaying(false); setPlayTime(Math.max(0, Math.min(total, t))); };

    // ---- routine run engine ----
    const run = useMemo(() => window.AUTO.buildRun(routine, project.paths, robot, routineOutcomes, plannerId), [routine, project.paths, robot, routineOutcomes, plannerId]);
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
      del: (id) => {
        const node = window.AUTO.findNode(routine, id);
        const label = node ? window.AUTO.nodeTitle(node, project.paths) : 'this routine step';
        if (!confirm('Delete “' + label + '” from the routine? Decision branches beneath it will also be removed.')) return;
        setRoutine((r) => window.AUTO.remove(r, id)); setRoutineSel(null);
      },
      move: (id, dir) => setRoutine((r) => window.AUTO.move(r, id, dir)),
      reorder: (id, targetId, before) => setRoutine((r) => window.AUTO.reorderRelative(r, id, targetId, before)),
      select: (id) => setRoutineSel(id),
      addAfter: (id, type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return window.AUTO.insertAfter(r, id, nn); }),
      addBranch: (decId, br, type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return window.AUTO.appendBranch(r, decId, br, nn); }),
      addEnd: (type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return window.AUTO.append(r, nn); }),
      prepend: (type, cat) => setRoutine((r) => { const nn = window.AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return window.AUTO.prepend(r, nn); }),
      setOutcome: (id, br) => setRoutineOutcomes((o) => ({ ...o, [id]: br })),
      rename: (nm) => setRoutine((r) => ({ ...r, name: nm })),
      openInEditor: (id) => { const idx = project.paths.findIndex((path) => path.id === id); if (idx >= 0) { setActive(idx); setPage('plan'); } },
    }), [routineOutcomes, routine, project.paths]);
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

    // ---- desktop project workflow ----
    const canReplaceProject = useCallback(() => !dirty || confirm('Discard unsaved changes to this project?'), [dirty]);
    const loadProject = useCallback((incoming) => {
      const next = normalizeProject(incoming);
      skipDirty.current = true;
      setProject(next);
      setPlannerId(next.plannerId || 'profiledSpline');
      setActiveIdx(0); setSel({ kind: null, idx: -1 }); setRoutineSel(null);
      hist.current = { past: [], future: [] };
      setDirty(false);
    }, []);
    useEffect(() => {
      let active = true;
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.restoreLastProject !== 'function') return undefined;
      window.bordeauxAPI.restoreLastProject().then((result) => { if (active && result) loadProject(result.project); }).catch((error) => console.warn('Could not restore the last project:', error));
      return () => { active = false; };
    }, [loadProject]);
    const newProject = useCallback(async () => {
      if (!canReplaceProject()) return;
      if (window.bordeauxAPI) await window.bordeauxAPI.newProject();
      loadProject(freshProject());
    }, [canReplaceProject, loadProject]);
    const openProject = useCallback(async (recentIndex) => {
      if (!window.bordeauxAPI || !canReplaceProject()) return;
      try {
        const result = typeof recentIndex === 'number'
          ? await window.bordeauxAPI.openRecentProject(recentIndex)
          : await window.bordeauxAPI.openProject();
        if (result) loadProject(result.project);
      } catch (error) {
        alert('Could not open project: ' + (error && error.message ? error.message : error));
      }
    }, [canReplaceProject, loadProject]);
    const saveProject = useCallback(async (saveAs) => {
      if (!window.bordeauxAPI) return;
      try {
        const result = await window.bordeauxAPI.saveProject({ ...project, routine, plannerId }, saveAs === true);
        if (result && result.canceled) return;
        setDirty(false);
      } catch (error) {
        alert('Could not save project: ' + (error && error.message ? error.message : error));
      }
    }, [project, routine, plannerId]);

    const onExportJava = useCallback(async (destination) => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.exportJava !== 'function') {
        alert('Java trajectory export is available in the Bordeaux desktop app.');
        return;
      }
      if (!javaProjectState.catalog) {
        alert('Link a Java robot project before exporting Java trajectory JSON.');
        return;
      }
      setJavaProjectState((current) => ({ ...current, operation: 'export', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.exportJava({ schemaVersion: '1.0', ...project, routine, plannerId }, destination === 'saveAs' ? 'saveAs' : 'linked');
        setJavaProjectState((current) => ({
          ...current,
          operation: null,
          notice: result && result.exported ? 'Exported Java trajectory to ' + result.relativePath + '.' : '',
        }));
      } catch (error) {
        setJavaProjectState((current) => ({ ...current, operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [project, routine, plannerId, javaProjectState.catalog]);

    useEffect(() => {
      if (!window.bordeauxAPI) return undefined;
      return window.bordeauxAPI.onMenuCommand(({ command, payload }) => {
        if (command === 'new-project') void newProject();
        else if (command === 'open-project') void openProject();
        else if (command === 'open-recent') void openProject(payload);
        else if (command === 'save-project') void saveProject(false);
        else if (command === 'save-project-as') void saveProject(true);
        else if (command === 'export-bdx') onExport();
        else if (command === 'export-java') void onExportJava('linked');
        else if (command === 'export-java-save-as') void onExportJava('saveAs');
        else if (command === 'java-link') void linkJavaProject();
        else if (command === 'java-install') void installJavaSupport();
        else if (command === 'java-build') void buildJavaCatalog();
        else if (command === 'java-cancel-build') void cancelJavaCatalogBuild();
      });
    }, [newProject, openProject, saveProject, project, routine, plannerId, onExportJava, linkJavaProject, installJavaSupport, buildJavaCatalog, cancelJavaCatalogBuild]);

    // ---- export ----
    const onExport = () => {
      if (window.bordeauxAPI && typeof window.bordeauxAPI.exportBdx === 'function') {
        window.bordeauxAPI.exportBdx({ schemaVersion: '1.0', ...project, routine, plannerId }, doc.id).catch((err) => {
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
        if (document.getElementById('boot-splash')) return;
        const matches = e.target.matches && e.target.matches.bind(e.target);
        if (e.key === 'Tab') { keyboardNavigation.current = true; return; }
        const nativeKeyboardControl = keyboardNavigation.current && matches && matches('button,select,input[type="range"]');
        const textEditing = nativeKeyboardControl || (matches && (matches('textarea,[contenteditable="true"]') || (matches('input:not([type="range"])') && !matches('.numinput'))));
        const k = e.key.toLowerCase();
        if (page === 'plan' && e.key === ' ' && !textEditing) {
          e.preventDefault();
          if (e.repeat) return;
          if (typeof e.target.blur === 'function') e.target.blur();
          togglePlayback();
          return;
        }
        const toolShortcut = !e.metaKey && !e.ctrlKey && !e.altKey && !textEditing && ({ v: 'select', w: 'waypoint', r: 'rotation', m: 'marker', c: 'range' })[k];
        if (page === 'plan' && toolShortcut) {
          e.preventDefault();
          if (typeof e.target.blur === 'function') e.target.blur();
          setTool(toolShortcut);
          return;
        }
        const formControl = matches && matches('input,select,textarea,[contenteditable="true"]');
        if (formControl) return;
        if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); return; }
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
        if (k === 'g') setShowGrid((s) => !s);
        else if (k === 'f') setView(FIT);
        else if (e.key === 'Escape') { setTool('select'); setHeadMenu(null); setDiagOpen(false); setWaypointPreview(null); select(null, -1); }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && sel.kind) {
          if (sel.kind === 'wp') delWp(sel.idx); else if (sel.kind === 'rt') delTarget(sel.idx); else if (sel.kind === 'em') delMarker(sel.idx); else if (sel.kind === 'cr') delRange(sel.idx);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo, sel, delWp, delTarget, delMarker, delRange, select, page, nudgeWp, nudgeFrac, alliance, togglePlayback]);

    const selNode = (page === 'auto' && routineSel) ? window.AUTO.findNode(routine, routineSel) : null;

    return h('div', { className: 'app' },
      h(window.Panels.Toolbar, { project, page, setPage, alliance, setAlliance, onNew: newProject, onOpen: openProject, onSave: saveProject, onUndo: undo, onRedo: redo, onExport, onExportJava: () => onExportJava('linked'), javaProject: javaProjectState, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times, plannerId, setPlannerId }),
      page === 'robot'
        ? h('main', { className: 'page-main' }, h(window.RobotPage, { robot, setRobot, accent, mcpEnabled, agentProposal: agentProposal && agentProposal.operation === 'configureRobot' ? agentProposal : null, onApplyProposal: applyAgentProposal, onRejectProposal: rejectAgentProposal }))
        : page === 'auto'
        ? h('main', { className: 'stage stage-auto' },
            h('nav', { className: 'rail rail-l', 'aria-label': 'Autonomous routine steps' },
              h(window.RoutinePanel, { routine, run, paths: project.paths, selId: routineSel, onSelect: setRoutineSel, acq, time: routineTime, running: routineRunning })),
            h('div', { className: 'fieldcol' },
              h(window.FieldView, { doc, derived, sel: { kind: null, idx: -1 }, tool: 'select', view, setView, alliance, showGrid, robot, drive: robot.drive, accent, metric, playTime: 0, actions: autoFieldActions, onSelPos: () => {}, routine: routineOverlay, routinePose }),
              h(window.Panels.RoutineLegend, { run, time: routineTime, running: routineRunning }),
              h(window.RoutineTransport, { run, time: routineTime, playing: routinePlaying, controls: routineControls, running: routineRunning, outcomes: routineOutcomes }),
              h(window.Panels.ViewControls, { zoomPct, zoomBy, onFit, showGrid, setShowGrid })),
            h('aside', { className: 'rail rail-r' + (selNode ? '' : ' collapsed'), 'aria-label': 'Routine step inspector' },
              selNode && h(window.StepInspector, { node: selNode, paths: project.paths, acq, run })))
        : h('main', { className: 'stage stage-plan' },
            h('nav', { className: 'rail rail-l' + (outlineOpen ? '' : ' collapsed'), 'aria-label': 'Path outline' },
              h(window.Panels.Outline, { open: outlineOpen, setOpen: setOutlineOpen, doc, derived, sel, actions: inspActions, secOpen, setSecOpen, robot })),
            h('div', { className: 'fieldcol' },
              h(window.Panels.ToolRail, { tool, setTool }),
              h(window.FieldView, { doc, derived, insertionPreview: waypointPreview, proposalPreviews: agentProposal && agentProposal.status === 'ready' ? agentProposalPreviews : [], sel, tool, view, setView, alliance, showGrid, robot, drive: robot.drive, accent, metric, playTime, playing, actions: fieldActions, onSelPos, showHandles: plannerId !== 'labviewClothoid' && !(plannerId === 'labviewBezier' && doc.labview && doc.labview.bezierTangentMode === 'automatic') }),
              tool !== 'select' && !waypointPreview && h('div', { className: 'stage-hint', dangerouslySetInnerHTML: { __html: toolHint(tool) } }),
              waypointPreview && h('div', { className: 'insert-preview', role: 'region', 'aria-label': 'Preview waypoint insertion' },
                h('div', { className: 'insert-preview-copy' },
                  h('b', null, 'Preview waypoint'),
                  h('span', null, waypointPreview.message)),
                h('div', { className: 'insert-preview-actions' },
                  h('button', { type: 'button', onClick: () => setWaypointPreview(null) }, 'Cancel'),
                  h('button', { className: 'primary', type: 'button', onClick: applyWaypointPreview }, waypointPreview.actionLabel || 'Insert waypoint'))),
              agentProposal && h('div', { className: 'insert-preview agent-proposal', role: 'region', 'aria-label': 'Agent path proposal' },
                h('div', { className: 'insert-preview-copy' },
                  h('b', null, agentProposal.operation === 'replace' ? 'Agent repair proposal' : 'Agent path proposal'),
                  h('span', null, agentProposal.intent),
                  h('span', { className: 'agent-proposal-status' }, agentProposal.status === 'ready' ? 'Preview only — the project has not changed.' : agentProposal.status === 'stale' ? 'Stale — the project changed. Ask the agent to regenerate.' : agentProposal.status === 'applied' ? 'Applied as one undoable project change.' : 'Rejected.'),
                  agentProposal.status === 'ready' && h('div', { className: 'agent-candidates', role: 'radiogroup', 'aria-label': 'Agent proposal candidates' }, agentCandidates.map((candidate) => h('button', { key: candidate.id, type: 'button', role: 'radio', 'aria-checked': agentCandidate && candidate.id === agentCandidate.id, className: agentCandidate && candidate.id === agentCandidate.id ? 'selected' : '', onClick: () => setAgentCandidateId(candidate.id) }, candidate.label + (candidate.valid === false ? ' · invalid' : candidate.metrics ? ' · ' + candidate.metrics.totalTimeS.toFixed(2) + ' s' : '')))),
                  agentCandidate && agentCandidate.metrics && h('span', null, agentCandidate.metrics.totalDistanceM.toFixed(2) + ' m · ' + agentCandidate.metrics.minimumClearanceM.toFixed(2) + ' m modeled clearance'),
                  agentCandidate && agentCandidate.valid === false && agentCandidate.rejectionReason && h('span', { className: 'agent-proposal-status' }, 'Blocked: ' + agentCandidate.rejectionReason),
                  agentProposal.recommendationReason && h('span', null, agentProposal.recommendationReason),
                  agentProposal.advisories && agentProposal.advisories.map((notice, index) => h('span', { key: 'advisory-' + index, className: 'agent-proposal-status' }, notice)),
                  agentProposal.blockingIssues && agentProposal.blockingIssues.map((issue, index) => h('span', { key: 'block-' + index, className: 'agent-proposal-status' }, 'Blocked: ' + issue))),
                h('div', { className: 'insert-preview-actions' },
                  agentProposal.status === 'ready' && h('button', { type: 'button', onClick: rejectAgentProposal }, 'Reject'),
                  agentProposal.status === 'ready' && h('button', { className: 'primary', type: 'button', disabled: !agentCandidate || agentCandidate.valid === false || (agentProposal.blockingIssues && agentProposal.blockingIssues.length > 0), onClick: applyAgentProposal }, agentProposal.operation === 'replace' ? 'Apply repair' : 'Add path'))),
              h(window.Panels.ConstraintBar, { c: doc.constraints, robot, onOpen: () => select(null, -1) }),
              h(window.Panels.Overlay, { metric, setMetric, derived, diagOpen, onToggleDiag: () => setDiagOpen((o) => !o), plannerId }),
              diagOpen && h(window.Panels.PathChecks, { derived, doc, onClose: () => setDiagOpen(false), onPick: pickCheck }),
              h(window.Panels.Transport, { derived, doc, metric, playTime, playing, togglePlayback, seek, restart, graphOpen, setGraphOpen }),
              h(window.Panels.ViewControls, { zoomPct, zoomBy, onFit, showGrid, setShowGrid })),
            h('aside', { className: 'rail rail-r' + (inspectorOpen ? '' : ' collapsed'), 'aria-label': 'Path inspector' },
              inspectorOpen
                ? h(window.ContextInspector, { doc, sel, derived, actions: inspActions, accent, drive: robot.drive, robot, plannerId, javaProject: { ...javaProjectState, link: linkJavaProject, openRecent: openRecentJavaProject, refresh: refreshJavaProject, install: installJavaSupport, build: buildJavaCatalog, cancelBuild: cancelJavaCatalogBuild, export: () => onExportJava('linked') }, onClose: () => setInspectorOpen(false) })
                : h('button', { className: 'inspector-tab', type: 'button', title: 'Show inspector', onClick: () => setInspectorOpen(true) }, h(window.UI.Icon, { name: 'sliders', size: 16 }), h('span', null, 'Inspector'))),
            headMenu && h(window.UI.ContextMenu, { x: headMenu.x, y: headMenu.y, items: headMenu.items, onClose: () => setHeadMenu(null) })));
  }

  function toolHint(tool) {
    if (tool === 'waypoint') return 'Click the field to place the <b>next endpoint</b>';
    if (tool === 'rotation') return 'Click the path to set a <b>rotation target</b>';
    if (tool === 'marker') return 'Click the path to place an <b>event marker</b>';
    if (tool === 'range') return 'Drag along the path to define a <b>constraint range</b> \u00b7 then edit its limits';
    return '';
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
