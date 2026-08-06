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
