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
