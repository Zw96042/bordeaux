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
