import * as React from "react";
import { FinalPlanning } from "../assets/final-planning";
import { PathEdit } from "../assets/path-edit";
import { PathPreview } from "../assets/path-preview";
import { ContextInspector } from "../components/ContextInspector";
import { FIELD_DIMS, FieldView } from "../components/FieldView";
import { Panels } from "../components/Panels";
import { RobotPage } from "../components/RobotPage";
import { DiagnosticBundleDialog } from "../components/DiagnosticBundleDialog";
import { RobotPushDialog } from "../components/RobotPushDialog";
import { RoutineTransport, StepInspector } from "../components/RoutineInspector";
import { RoutinePanel } from "../components/RoutinePanel";
import { UI } from "../components/ui";
import { PM } from "../lib/pathMath";
import { PathLinks } from "../lib/pathLinks";
import { AUTO } from "../lib/routineModel";
import { UnitPrefs } from "../lib/unitPreferences";
import {
  createMarkerId as markerId,
  createPathId as pathId,
  createPathLinkId as pathLinkId,
  createRoutineId as routineId,
} from "../../shared/project/ids";
import { normalizeProject as normalizeProjectData } from "../../shared/project/normalize";
import { ACTIVE_FIELD_REFERENCE } from "../../shared/field/rebuilt2026";

// Bordeaux application root.
  const { useState, useRef, useEffect, useMemo, useCallback, useSyncExternalStore } = React;
  const h = React.createElement;
  const { FIELD_W, FIELD_H, IMG_W, IMG_H } = FIELD_DIMS;
  const PERSEG = 56;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });
  const blankRoutine = (name) => ({ id: routineId(), name: name || 'Autonomous Routine', nodes: [] });
  function normalizeProject(raw) {
    return PathLinks.reconcile(normalizeProjectData(raw));
  }

  function agentProposalMatchesPublishedContext(proposal, sessionId, publishedContext, currentContext) {
    return Boolean(proposal && publishedContext
      && proposal.baseSessionId === sessionId
      && proposal.baseRevision === publishedContext.revision
      && proposal.baseActivePathId === publishedContext.activePathId
      && publishedContext.project === currentContext.project
      && publishedContext.activePathId === currentContext.activePathId
      && publishedContext.editRevision === currentContext.editRevision
      && (!proposal.baseJavaCatalogFingerprint || proposal.baseJavaCatalogFingerprint === currentContext.javaCatalogFingerprint)
      && !currentContext.hasDraft);
  }

  const ACCENT = '#3f6fd0';

  const DEF_CONS = { maxVel: 4.2, maxAccel: 6.5, maxDecel: 6.5, maxAngVel: 540, maxAngAccel: 720, maxAngDecel: 720, maxJerk: 0, maxAngJerk: 0 };
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
    out.forEach((w, i) => { const hd = PM.autoHandles(out, i); if (!w.prevC) w.prevC = hd.prevC; if (!w.nextC) w.nextC = hd.nextC; });
    out.forEach((w, i) => { if (!w.stop && i > 0 && i < out.length - 1) alignWaypointHandles(w); });
    if (out.length) { out[0].thetaOn = true; out[out.length - 1].thetaOn = true; }
    return out;
  }

  function remapWaypointRanges(doc, oldToNew, removedIndex) {
    doc.ranges = (doc.ranges || []).map((range) => PM.remapWaypointRange(range, oldToNew, removedIndex, doc.waypoints.length));
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
    };
  }

  function freshProject() {
    const routine = blankRoutine();
    const path = blankPath('NewPath');
    return {
      schemaVersion: '1.0',
      field: { ...ACTIVE_FIELD_REFERENCE },
      name: 'Untitled',
      robot: { drive: 'swerve', w: 0.84, l: 0.84, heightM: 0.5, maxSpeed: 5.0 },
      paths: [path],
      pathLinks: [],
      routines: [routine],
      activeRoutineId: routine.id,
      plannerId: 'profiledSpline',
      editor: { activePathId: path.id },
    };
  }

  function routineState(project) {
    const routines = Array.isArray(project.routines) && project.routines.length
      ? project.routines : [blankRoutine()];
    const activeRoutineId = routines.some((routine) => routine.id === project.activeRoutineId)
      ? project.activeRoutineId : routines[0].id;
    return { routines, activeRoutineId };
  }

  function withRoutineState(project, state) {
    const activeRoutine = state.routines.find((routine) => routine.id === state.activeRoutineId) || state.routines[0];
    return { ...project, routines: state.routines, activeRoutineId: activeRoutine.id };
  }

  const FIT = { x: 307, y: 7, w: 3285, h: 1569 };

  function createPlaybackStore() {
    let snapshot = { time: 0, playing: false, total: 0 };
    let frame = 0, last = 0;
    const listeners = new Set();
    const emit = (patch) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); };
    const stopFrame = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const tick = (now) => {
      const time = Math.min(snapshot.total, snapshot.time + (now - last) / 1000); last = now;
      const playing = time < snapshot.total - 1e-6;
      emit({ time, playing });
      frame = playing ? requestAnimationFrame(tick) : 0;
    };
    const startFrame = () => { if (frame || !snapshot.playing) return; last = performance.now(); frame = requestAnimationFrame(tick); };
    return {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      getSnapshot() { return snapshot; },
      setTotal(total) { const next = Math.max(0, total || 0); emit({ total: next, time: Math.min(snapshot.time, next), playing: snapshot.playing && snapshot.time < next }); startFrame(); },
      toggle() {
        if (snapshot.playing) { stopFrame(); emit({ playing: false }); return; }
        emit({ time: snapshot.time >= snapshot.total - 1e-3 ? 0 : snapshot.time, playing: snapshot.total > 0 }); startFrame();
      },
      restart() { stopFrame(); emit({ time: 0, playing: snapshot.total > 0 }); startFrame(); },
      pause() { stopFrame(); if (snapshot.playing) emit({ playing: false }); },
      seek(time) { stopFrame(); emit({ time: Math.max(0, Math.min(snapshot.total, time)), playing: false }); },
      reset() { stopFrame(); emit({ time: 0, playing: false }); },
      destroy() { stopFrame(); listeners.clear(); },
    };
  }

  const usePlayback = (store) => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  function EditablePlaybackField({ store, editStore, doc, derived, derivedPath, robot, plannerId, ...props }) {
    const playback = usePlayback(store);
    const draft = useSyncExternalStore(editStore.subscribe, editStore.getSnapshot, editStore.getSnapshot);
    const previewer = useMemo(() => PathPreview.create(), []);
    const editBase = useRef(null);
    const [preview, setPreview] = useState(() => previewer.getSnapshot());
    useEffect(() => previewer.retain(), [previewer]);
    useEffect(() => previewer.subscribe(() => setPreview(previewer.getSnapshot())), [previewer]);
    useEffect(() => {
      if (draft) previewer.request({ key: draft.id, path: draft, robot, plannerId, quality: 'interactive' });
    }, [previewer, draft, robot, plannerId]);
    if (draft && !editBase.current) editBase.current = doc;
    const finished = !draft && editStore.getLastResolution() === 'finish';
    const bridgeFinishedEdit = finished && editBase.current && (editBase.current === doc || derivedPath !== doc);
    if (!draft && (!finished || (derivedPath === doc && editBase.current !== doc))) editBase.current = null;
    const draftPreview = draft && preview.path && preview.path.id === draft.id && preview.value
      ? { path: preview.path, value: preview.value }
      : null;
    const committedPreview = !draft && preview.path && preview.path.id === doc.id && preview.value && bridgeFinishedEdit
      ? { path: preview.path, value: preview.value }
      : null;
    const displayed = draftPreview || committedPreview || { path: derivedPath || doc, value: derived };
    const currentSource = draft || doc;
    return h(FieldView, { ...props, editStore, doc: displayed.path, derived: displayed.value, interactionReady: displayed.path === currentSource, robot, playTime: playback.time });
  }
  function PlaybackTransport({ store, ...props }) {
    const playback = usePlayback(store);
    return h(Panels.Transport, { ...props, playTime: playback.time, playing: playback.playing,
      togglePlayback: store.toggle, seek: store.seek, restart: store.restart });
  }
  function RoutinePanelPlayback({ store, ...props }) {
    const playback = usePlayback(store);
    return h(RoutinePanel, { ...props, time: playback.time, running: playback.playing || playback.time > 0.001 });
  }
  function RoutineFieldPlayback({ store, run, selectedId, robot, ...props }) {
    const playback = usePlayback(store), running = playback.playing || playback.time > 0.001;
    const overlay = useMemo(() => AUTO.fieldOverlay(run, { time: playback.time, running, selectedId }), [run, playback.time, running, selectedId]);
    const pose = AUTO.poseAt(run, playback.time, robot);
    return h(FieldView, { ...props, robot, playTime: 0, routine: overlay, routinePose: pose });
  }
  function RoutineTransportPlayback({ store, run }) {
    const playback = usePlayback(store), running = playback.playing || playback.time > 0.001;
    return h(RoutineTransport, { run, time: playback.time, playing: playback.playing, controls: store, running });
  }

  /** Keeps the last valid interactive result visible while final planning runs independently. */
  function useFinalPlanning(doc, robot, plannerId) {
    const previewer = useMemo(() => PathPreview.create(), []);
    const planner = useMemo(() => FinalPlanning.create(), []);
    const [initial] = useState(() => {
      try { return { path: doc, value: PM.derivePath(doc, robot, 14, plannerId), error: null }; }
      catch (error) { return { path: doc, value: null, error }; }
    });
    const lastValid = useRef(initial.value ? { path: initial.path, value: initial.value } : null);
    const requestedRevision = useRef(0);
    const [interactive, setInteractive] = useState(() => previewer.getSnapshot());
    const [snapshot, setSnapshot] = useState(() => ({
      status: initial.value ? 'ready' : 'error',
      key: doc.id,
      path: initial.path,
      value: initial.value,
      error: initial.error,
      errorPath: initial.error ? initial.path : null,
      durationMs: 0,
    }));

    useEffect(() => previewer.retain(), [previewer]);
    useEffect(() => previewer.subscribe(() => setInteractive(previewer.getSnapshot())), [previewer]);
    useEffect(() => {
      requestedRevision.current = previewer.request({ key: doc.id, path: doc, robot, plannerId, quality: 'interactive' });
    }, [previewer, doc, robot, plannerId]);
    useEffect(() => {
      if (interactive.revision !== requestedRevision.current || interactive.path !== doc) return undefined;
      if (interactive.status === 'error') {
        setSnapshot({
          status: 'error', key: doc.id, path: lastValid.current?.path || doc, value: lastValid.current?.value || null,
          error: interactive.error, errorPath: doc, durationMs: 0,
        });
        return undefined;
      }
      if (interactive.status !== 'ready' || !interactive.value) return undefined;
      let active = true;
      const interactiveResult = interactive.value;
      lastValid.current = { path: doc, value: interactiveResult };
      const request = planner.request(
        { key: doc.id, path: doc, robot, plannerId },
        { interactiveResult, deadline: 'common' },
      );
      setSnapshot({ status: 'pending', key: doc.id, path: doc, value: interactiveResult, error: null, errorPath: null, durationMs: 0 });
      request.promise.then((result) => {
        if (!active) return;
        if (result.status === 'success') {
          setSnapshot({ status: 'ready', key: doc.id, path: doc, value: result.value, error: null, errorPath: null, durationMs: result.durationMs || 0 });
          return;
        }
        setSnapshot({
          status: result.status,
          key: doc.id,
          path: doc,
          value: result.fallback || interactiveResult,
          error: new Error(result.fallbackReason),
          errorPath: doc,
          durationMs: 0,
        });
      });
      return () => { active = false; request.cancel(); };
    }, [planner, doc, robot, plannerId, interactive]);

    const current = snapshot.path === doc && snapshot.value
      ? { path: doc, value: snapshot.value }
      : null;
    if (current) lastValid.current = current;
    const displayed = current || lastValid.current;
    return {
      value: displayed && displayed.value,
      path: displayed && displayed.path,
      error: snapshot.errorPath === doc ? snapshot.error : null,
      pending: interactive.status === 'pending' || snapshot.status === 'pending',
      durationMs: snapshot.durationMs || 0,
      optimization: snapshot.value?.finalOptimization || null,
    };
  }

  function App() {
    const [project, setProject] = useState(() => freshProject());
    const plannerId = project.plannerId;
    const [activeIdx, setActiveIdx] = useState(0);
    const [sel, setSel] = useState({ kind: null, idx: -1 });
    const [page, setPage] = useState('plan');
    const [alliance, setAlliance] = useState('blue');
    const [showGrid, setShowGrid] = useState(true);
    const [view, setView] = useState(FIT);
    const [graphOpen, setGraphOpen] = useState(false);
    const [outlineOpen, setOutlineOpen] = useState(true);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    const [secOpen, setSecOpen] = useState({ wp: true, sg: false, rt: false, em: false, cr: false });
    const [times, setTimes] = useState({});
    const [metric, setMetric] = useState('velocity');
    const [tool, setTool] = useState('select');
    const [waypointPreview, setWaypointPreview] = useState(null);
    const [headMenu, setHeadMenu] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [agentProposal, setAgentProposal] = useState(null);
    const [agentCandidateId, setAgentCandidateId] = useState(null);
    const [mcpEnabled, setMcpEnabled] = useState(false);
    const [agentSessionId] = useState(() => 'session_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)));
    const [agentEditResolutionRevision, setAgentEditResolutionRevision] = useState(0);
    const agentRevision = useRef(-1);
    const agentPublishedContext = useRef(null);
    const agentProposalRef = useRef(agentProposal); agentProposalRef.current = agentProposal;
    const agentProposalContext = useRef(null);
    const [javaProjectState, setJavaProjectState] = useState({ status: 'unlinked', operation: null, catalog: null, integration: null, error: '', notice: '', bookmarkId: null, recentProjects: [] });
    const javaCatalogFingerprint = useRef(null);
    if (javaProjectState.catalog && javaProjectState.catalog.semanticFingerprint) javaCatalogFingerprint.current = javaProjectState.catalog.semanticFingerprint;
    else if (!javaProjectState.operation) javaCatalogFingerprint.current = null;
    const [exportError, setExportError] = useState('');
    const [unitSystem, setUnitSystemState] = useState(() => UnitPrefs.current());
    const setUnitSystem = useCallback((next) => setUnitSystemState(UnitPrefs.set(next)), []);
    const javaRestoreGeneration = useRef(0);
    const skipDirty = useRef(true);
    const keyboardNavigation = useRef(false);
    const editStore = useMemo(() => PathEdit.create(), []);
    const playbackStore = useMemo(() => createPlaybackStore(), []);
    const routinePlaybackStore = useMemo(() => createPlaybackStore(), []);
    useEffect(() => () => { playbackStore.destroy(); routinePlaybackStore.destroy(); }, [playbackStore, routinePlaybackStore]);

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
      setExportError('');
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
      if (result.bookmarkId) {
        setProject((current) => current.editor && current.editor.javaProjectBookmarkId === result.bookmarkId
          ? current
          : { ...current, editor: { ...(current.editor || {}), javaProjectBookmarkId: result.bookmarkId } });
      }
    }, []);

    const linkJavaProject = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.linkJavaProject !== 'function') {
        setJavaProjectState((current) => ({ ...current, status: 'error', error: 'Java project discovery is available in the Bordeaux desktop app.' }));
        return;
      }
      const generation = ++javaRestoreGeneration.current;
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.linkJavaProject();
        if (javaRestoreGeneration.current !== generation) return;
        if (!result) {
          setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'ready' : 'unlinked', operation: null, error: '' }));
          return;
        }
        applyJavaProjectConnection(result);
      } catch (error) {
        if (javaRestoreGeneration.current !== generation) return;
        setJavaProjectState((current) => ({ ...current, status: 'error', operation: null, catalog: null, integration: null, bookmarkId: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const openRecentJavaProject = useCallback(async (id, expectedGeneration) => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.openRecentJavaProject !== 'function') return;
      const generation = expectedGeneration == null ? ++javaRestoreGeneration.current : expectedGeneration;
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.openRecentJavaProject(id);
        if (javaRestoreGeneration.current !== generation) return;
        applyJavaProjectConnection(result);
      } catch (error) {
        if (javaRestoreGeneration.current !== generation) return;
        setJavaProjectState((current) => ({ ...current, status: 'error', operation: null, catalog: null, integration: null, bookmarkId: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const refreshJavaProject = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.refreshJavaProject !== 'function') return;
      const generation = javaRestoreGeneration.current;
      setJavaProjectState((current) => ({ ...current, status: 'loading', operation: 'scan', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.refreshJavaProject();
        if (javaRestoreGeneration.current !== generation) return;
        applyJavaProjectConnection(result);
      } catch (error) {
        if (javaRestoreGeneration.current !== generation) return;
        setJavaProjectState((current) => ({ ...current, status: current.catalog ? 'stale' : 'error', operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const installJavaSupport = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.installJavaSupport !== 'function') return;
      const generation = javaRestoreGeneration.current;
      setJavaProjectState((current) => ({ ...current, operation: 'install', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.installJavaSupport();
        if (javaRestoreGeneration.current !== generation) return;
        if (result) {
          applyJavaProjectConnection(result);
          setJavaProjectState((current) => ({ ...current, notice: 'Support installed. Annotate command factories, follow .bordeaux/INTEGRATION.md for RobotContainer wiring, then build the catalog.' }));
        }
        else setJavaProjectState((current) => ({ ...current, operation: null }));
      } catch (error) {
        if (javaRestoreGeneration.current !== generation) return;
        setJavaProjectState((current) => ({ ...current, operation: null, error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const buildJavaCatalog = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.buildJavaCatalog !== 'function') return;
      const generation = javaRestoreGeneration.current;
      setJavaProjectState((current) => ({ ...current, operation: 'build', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.buildJavaCatalog();
        if (javaRestoreGeneration.current !== generation) return;
        if (result) {
          applyJavaProjectConnection(result);
          setJavaProjectState((current) => ({ ...current, notice: 'Generated command catalog built and loaded.' }));
        }
        else setJavaProjectState((current) => ({ ...current, operation: null }));
      } catch (error) {
        if (javaRestoreGeneration.current !== generation) return;
        setJavaProjectState((current) => ({ ...current, operation: null, status: current.catalog ? 'stale' : 'error', error: error && error.message ? error.message : String(error) }));
      }
    }, [applyJavaProjectConnection]);

    const cancelJavaCatalogBuild = useCallback(async () => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.cancelJavaCatalogBuild !== 'function') return;
      const result = await window.bordeauxAPI.cancelJavaCatalogBuild();
      setJavaProjectState((current) => ({ ...current, notice: result && result.canceled ? 'Canceling the Java catalog build…' : 'No Java catalog build is running.' }));
    }, []);

    // ---- Autonomous Routine ----
    const routineLibrary = routineState(project);
    const routines = routineLibrary.routines;
    const routine = routines.find((candidate) => candidate.id === routineLibrary.activeRoutineId) || routines[0];
    const commitRoutineState = useCallback((update) => setProject((current) => {
      const currentState = routineState(current);
      routineHist.current.past.push(clone(currentState));
      if (routineHist.current.past.length > 80) routineHist.current.past.shift();
      routineHist.current.future = [];
      hist.current.past = []; hist.current.future = [];
      projectHist.current.future = [];
      return withRoutineState(current, update(clone(currentState)));
    }), []);
    const setRoutine = useCallback((update) => commitRoutineState((state) => {
      const current = state.routines.find((candidate) => candidate.id === state.activeRoutineId) || state.routines[0];
      const value = typeof update === 'function' ? update(current) : update;
      return { ...state, routines: state.routines.map((candidate) => candidate.id === current.id ? value : candidate) };
    }), [commitRoutineState]);
    const [routineOutcomes, setRoutineOutcomes] = useState({});
    const [routineSel, setRoutineSel] = useState(null);

    const robot = project.robot;
    const accent = ACCENT;
    useEffect(() => {
      if (waypointPreviewRequest) requestWaypointPreview(waypointPreviewer, waypointPreviewRequest, robot, plannerId);
    }, [waypointPreviewer, waypointPreviewRequest, robot, plannerId]);
    const waypointPreview = waypointPreviewResult(waypointPreviewSnapshot, waypointPreviewRequest);

    const doc = project.paths[activeIdx];
    const docRef = useRef(doc); docRef.current = doc;
    const selRef = useRef(sel); selRef.current = sel;
    const projectRef = useRef(project); projectRef.current = project;
    const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
    const hist = useRef({ past: [], future: [] });
    const routineHist = useRef({ past: [], future: [] });
    const projectHist = useRef({ past: [], future: [] });
    const autosaveRevision = useRef(0);
    const autosaveTimer = useRef(0);
    const draftInputGeneration = useRef(0);
    const persistenceTail = useRef(Promise.resolve());
    const [, force] = useState(0);
    const updateDirty = useCallback((next) => {
      dirtyRef.current = next;
      setDirty(next);
      if (window.bordeauxAPI && typeof window.bordeauxAPI.setDirty === 'function') window.bordeauxAPI.setDirty(next);
    }, []);
    const flushProjectDraft = useCallback(() => flushFocusedProjectDraft(document, flushSync), []);
    const markAgentProposalStale = useCallback(() => {
      const current = agentProposalRef.current;
      if (!current || current.status !== 'ready') return;
      const stale = { ...current, status: 'stale' };
      agentProposalRef.current = stale;
      setAgentProposal(stale);
      if (window.bordeauxAPI && typeof window.bordeauxAPI.updateAgentProposalStatus === 'function') {
        window.bordeauxAPI.updateAgentProposalStatus(current.id, 'stale');
      }
    }, []);
    const materializeProject = useCallback(() => {
      const base = projectRef.current;
      const draft = editStore.getSnapshot();
      const materialized = editStore.materialize(base);
      if (!draft || materialized === base) return base;
      const before = base.paths.find((path) => path.id === draft.id);
      return PathLinks.sync(materialized, draft.id, before);
    }, [editStore]);
    const pushController = useRobotPushController({ getProject: materializeProject, projectKey, catalogKey: javaProjectState.catalog?.catalogHash, bookmarkKey: javaProjectState.bookmarkId });
    const enqueuePersistence = useCallback((operation) => {
      const pending = persistenceTail.current.catch(() => undefined).then(operation);
      persistenceTail.current = pending.then(() => undefined, () => undefined);
      return pending;
    }, []);
    const invalidateScheduledAutosave = useCallback(() => {
      autosaveRevision.current += 1;
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = 0;
    }, []);
    const scheduleAutosave = useCallback((immediate) => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.autosaveProject !== 'function') return;
      const revision = ++autosaveRevision.current;
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = 0;
      const persist = () => enqueuePersistence(async () => {
        if (!flushProjectDraft()) return;
        if (revision !== autosaveRevision.current) return;
        const sourceProject = projectRef.current;
        const editRevision = editStore.getRevision();
        const result = await window.bordeauxAPI.autosaveProject(materializeProject());
        if (revision === autosaveRevision.current && sourceProject === projectRef.current
          && editRevision === editStore.getRevision() && !editStore.getSnapshot() && result && result.saved) updateDirty(false);
      });
      if (immediate === true) {
        void persist().catch((error) => console.warn('Could not autosave the Bordeaux project:', error));
        return;
      }
      autosaveTimer.current = window.setTimeout(() => {
        autosaveTimer.current = 0;
        void persist().catch((error) => console.warn('Could not autosave the Bordeaux project:', error));
      }, 900);
    }, [editStore, enqueuePersistence, flushProjectDraft, materializeProject, updateDirty]);

    useEffect(() => {
      const onDraftInput = (event) => {
        if (noteProjectDraftInput(event.target, dirtyRef.current, () => updateDirty(true), scheduleAutosave)) {
          draftInputGeneration.current += 1;
        }
      };
      // React must record the draft before dirty-state rendering can restore the
      // controlled input value. Observe after its root input handler has run.
      document.addEventListener('input', onDraftInput);
      return () => document.removeEventListener('input', onDraftInput);
    }, [scheduleAutosave, updateDirty]);

    useEffect(() => {
      const activePathId = project.paths[activeIdx] && project.paths[activeIdx].id;
      if (!activePathId || (project.editor && project.editor.activePathId === activePathId)) return;
      setProject((current) => ({ ...current, editor: { ...(current.editor || {}), activePathId } }));
    }, [activeIdx, project.paths, project.editor && project.editor.activePathId]);

    useEffect(() => {
      if (skipDirty.current) skipDirty.current = false;
      else updateDirty(true);
    }, [project, updateDirty]);
    useEffect(() => scheduleAutosave(), [project, scheduleAutosave]);
    useEffect(() => editStore.subscribe(() => {
      const draft = editStore.getSnapshot();
      const canceled = !draft && editStore.getLastResolution() === 'cancel';
      if (!draft && !canceled) return;
      markAgentProposalStale();
      if (canceled) setAgentEditResolutionRevision((revision) => revision + 1);
      if (canceled || !dirtyRef.current) updateDirty(true);
      scheduleAutosave(canceled);
    }), [editStore, markAgentProposalStale, scheduleAutosave, updateDirty]);
    useEffect(() => () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    }, []);
    useEffect(() => markAgentProposalStale(), [project, activeIdx, markAgentProposalStale]);
    useEffect(() => {
      if (javaProjectState.operation) return;
      const current = agentProposalRef.current;
      if (current?.status === 'ready' && current.baseJavaCatalogFingerprint
        && current.baseJavaCatalogFingerprint !== javaCatalogFingerprint.current) markAgentProposalStale();
    }, [javaProjectState.operation, javaProjectState.catalog && javaProjectState.catalog.semanticFingerprint, markAgentProposalStale]);
    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.publishAgentSession !== 'function') return;
      let published = false;
      const publish = () => {
        if (published) return;
        published = true;
        const sourceProject = projectRef.current;
        const activePathId = docRef.current && docRef.current.id;
        const editRevision = editStore.getRevision();
        agentRevision.current += 1;
        const revision = agentRevision.current;
        agentPublishedContext.current = { revision, project: sourceProject, activePathId, editRevision };
        window.bordeauxAPI.publishAgentSession({
          sessionId: agentSessionId,
          revision,
          project: clone(materializeProject()),
          activePathId,
          allianceView: 'blue',
          fieldPack: { id: '2026-rebuilt', revision: '2026-manual-tu19-welded-4' },
        });
        setAgentProposal((current) => {
          if (!current || current.status !== 'ready' || current.baseRevision === revision) return current;
          window.bordeauxAPI.updateAgentProposalStatus(current.id, 'stale');
          const stale = { ...current, status: 'stale' };
          agentProposalRef.current = stale;
          return stale;
        });
      };
      const timer = window.setTimeout(publish, 150);
      window.addEventListener('pointerup', publish, { once: true });
      return () => { window.clearTimeout(timer); window.removeEventListener('pointerup', publish); };
    }, [project, activeIdx, agentSessionId, agentEditResolutionRevision, doc.id, materializeProject]);
    useEffect(() => {
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.onAgentProposal !== 'function') return;
      let active = true;
      let receivedLiveProposal = false;
      let lastProposalKey = '';
      const receiveProposal = (proposal) => {
        if (!active || !proposal) return;
        const proposalKey = proposal.id + ':' + proposal.status;
        if (proposalKey === lastProposalKey) return;
        lastProposalKey = proposalKey;
        const publishedContext = agentPublishedContext.current;
        const currentActivePathId = docRef.current && docRef.current.id;
        const stale = !agentProposalMatchesPublishedContext(proposal, agentSessionId, publishedContext, {
          project: projectRef.current,
          activePathId: currentActivePathId,
          editRevision: editStore.getRevision(),
          javaCatalogFingerprint: javaCatalogFingerprint.current,
          hasDraft: Boolean(editStore.getSnapshot()),
        });
        const received = stale && proposal.status === 'ready' ? { ...proposal, status: 'stale' } : proposal;
        agentProposalContext.current = {
          id: proposal.id,
          published: publishedContext,
        };
        agentProposalRef.current = received;
        if (stale && proposal.status === 'ready' && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(proposal.id, 'stale');
        if (window.bordeauxAPI.acknowledgeAgentProposal) {
          const receiptRevision = publishedContext ? publishedContext.revision : agentRevision.current >= 0 ? agentRevision.current : proposal.baseRevision;
          const receiptActivePathId = publishedContext ? publishedContext.activePathId : currentActivePathId || proposal.baseActivePathId;
          window.bordeauxAPI.acknowledgeAgentProposal(proposal.id, agentSessionId, receiptRevision, receiptActivePathId, !stale);
        }
        setAgentProposal(received);
        setAgentCandidateId(proposal.recommendedCandidateId || null);
        setPage(proposal.operation === 'configureRobot' ? 'robot' : 'plan');
      };
      const unsubscribe = window.bordeauxAPI.onAgentProposal((proposal) => {
        receivedLiveProposal = true;
        receiveProposal(proposal);
      });
      if (typeof window.bordeauxAPI.getActiveAgentProposal === 'function') {
        Promise.resolve(window.bordeauxAPI.getActiveAgentProposal()).then((proposal) => {
          if (!receivedLiveProposal) receiveProposal(proposal);
        }).catch(() => undefined);
      }
      return () => { active = false; unsubscribe(); };
    }, [agentSessionId, editStore]);
    useEffect(() => {
      const onPointerDown = () => { keyboardNavigation.current = false; };
      window.addEventListener('pointerdown', onPointerDown, true);
      return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, []);
    useEffect(() => {
      const pauseHiddenPlayback = () => {
        if (document.hidden) { playbackStore.pause(); routinePlaybackStore.pause(); }
      };
      document.addEventListener('visibilitychange', pauseHiddenPlayback);
      return () => document.removeEventListener('visibilitychange', pauseHiddenPlayback);
    }, []);

    // A search candidate never owns the selected result. Apply persists that choice.
    const optimizer = useMemo(() => PathOptimization.create({ getProject: () => projectRef.current }), []);
    const optimizationState = useSyncExternalStore(optimizer.subscribe, optimizer.getSnapshot, optimizer.getSnapshot);
    useEffect(() => { optimizer.sync(); }, [optimizer, project]);
    useEffect(() => () => optimizer.cancel(), [optimizer]);
    const optimizationKey = useMemo(() => optimizationInputKey(doc, robot, project.field), [doc, robot, project.field]);
    const planningPath = useMemo(() => ({ ...doc }), [doc.id, optimizationKey, doc.optimization?.accepted]);
    const normalPath = useMemo(() => authoredPath(doc), [doc.id, optimizationKey]);
    const planningRobot = useMemo(() => robot, [optimizationKey]);
    const selectedPlanning = useFinalPlanning(planningPath, planningRobot, plannerId);
    const currentOptimization = Boolean(doc.optimization?.accepted && !isOptimizationOutdated(doc, robot, project.field));
    const normalPlanning = useFinalPlanning(normalPath, planningRobot, plannerId, optimizationOpen && currentOptimization);
    const normal = currentOptimization ? normalPlanning : selectedPlanning;
    const selectedReady = selectedPlanning.path === planningPath && !selectedPlanning.pending && Boolean(selectedPlanning.value?.finalTrajectory);
    const justApplied = appliedPreview.current?.artifact === doc.optimization?.accepted && appliedPreview.current?.key === optimizationKey
      ? appliedPreview.current.value : null;
    const acceptedPreview = selectedReady ? (selectedPlanning.value.acceptedTrajectory ? selectedPlanning.value : null) : justApplied;
    const accepted = acceptedPreview?.finalTrajectory || null;
    const staleOptimization = Boolean(doc.optimization?.accepted && (doc.optimization.accepted.inputKey !== optimizationKey || (selectedReady && !accepted)));
    const optimizationEntry = optimizationState.paths[doc.id];
    const candidate = optimizationEntry?.key === optimizationKey ? optimizationEntry.value : null;
    const normalReady = normal.path === (currentOptimization ? normalPath : planningPath)
      && !normal.pending && !normal.error && Boolean(normal.value?.finalTrajectory);
    const normalError = normal.error;
    const normalBaseline = useRef(null);
    if (normalReady) normalBaseline.current = { id: doc.id, key: optimizationKey, time: normal.value.prof.totalTime };
    // Applying changes selection, not the normal baseline. Keep its comparison
    // time while the accepted-result worker starts, only for identical inputs.
    const baselineTime = normalBaseline.current?.id === doc.id && normalBaseline.current.key === optimizationKey
      ? normalBaseline.current.time : null;
    const comparisonMode = comparison?.id === doc.id && comparison.key === optimizationKey ? comparison.mode : 'selected';
    const comparedPreview = comparisonMode === 'candidate' ? candidate : comparisonMode === 'normal' && normalReady ? normal.value : null;
    const selectedPreview = comparedPreview || acceptedPreview;
    const derivation = selectedPreview
      ? { value: selectedPreview, path: doc, current: true, pending: false, error: null, errorKind: null }
      : { ...selectedPlanning, path: selectedPlanning.path === planningPath ? doc : selectedPlanning.path };
    const planningNotice = usePlanningNotice(derivation.error, derivation.errorKind, planningInputRevision, doc.id);
    const derived = derivation.value || PENDING_PATH_PREVIEW;
    const derivationDoc = derivation.path || doc;
    const derivationCurrent = derivation.current;
    const reverseDistance = currentPathLength(derivation);

    const durationInputs = useMemo(() => project.paths.map((path) => ({
      id: path.id, path, robot, plannerId,
      key: JSON.stringify([optimizationInputKey(path, robot, project.field), robot.planning, plannerId, path.optimization?.accepted]),
      outdatedOptimization: isOptimizationOutdated(path, robot, project.field),
    })), [project.paths, robot, plannerId, project.field]);
    useEffect(() => {
      const error = selectedPlanning.error || (currentOptimization && selectedReady && !accepted ? new Error('The selected optimization could not be validated. Review this path.') : null);
      libraryDurations.update(durationInputs, error
        ? { id: doc.id, status: 'error', message: error.message }
        : selectedReady
          ? { id: doc.id, status: 'ready', seconds: selectedPlanning.value.prof.totalTime }
          : { id: doc.id, status: 'pending' });
    }, [libraryDurations, durationInputs, doc.id, selectedReady, selectedPlanning.value, selectedPlanning.error, currentOptimization, accepted]);

    const writeDoc = useCallback((nd) => {
      setPlanningInputRevision((revision) => revision + 1);
      setProject((pr) => {
        const paths = pr.paths.slice(), before = paths[activeIdx]; paths[activeIdx] = nd;
        return PathLinks.sync({ ...pr, paths }, nd.id, before);
      });
    }, [activeIdx]);
    const beginHistory = useCallback(() => { hist.current.past.push(clone(docRef.current)); if (hist.current.past.length > 80) hist.current.past.shift(); hist.current.future = []; projectHist.current.future = []; force((x) => x + 1); }, []);
    const beginEdit = useCallback(() => {
      if (editStore.getSnapshot()) return;
      editStore.begin(clone(docRef.current));
    }, [editStore]);
    const finishEdit = useCallback(() => {
      const next = editStore.finish();
      if (!next) return;
      beginHistory();
      writeDoc(next);
    }, [beginHistory, editStore, writeDoc]);
    const cancelEdit = useCallback(() => {
      return editStore.cancel();
    }, [editStore]);
    const commit = useCallback((fn) => {
      cancelEdit();
      beginHistory();
      writeDoc(fn(clone(docRef.current)));
    }, [beginHistory, cancelEdit, writeDoc]);
    useEffect(() => {
      const draft = editStore.getSnapshot();
      if (draft && doc && draft.id !== doc.id) cancelEdit();
    }, [doc && doc.id, editStore, cancelEdit]);
    const mutate = useCallback((fn) => {
      const draft = editStore.getSnapshot();
      if (!draft) { writeDoc(fn(clone(docRef.current))); return; }
      editStore.update(fn(clone(draft)));
    }, [editStore, writeDoc]);

    const waypointSnapshot = (current) => ({
      waypoints: Object.fromEntries(current.paths.map((path) => [path.id, clone(path.waypoints)])),
      pathLinks: clone(current.pathLinks),
    });
    const restoreWaypointSnapshot = (current, snapshot) => ({ ...current,
      paths: current.paths.map((path) => snapshot.waypoints[path.id] ? { ...path, waypoints: clone(snapshot.waypoints[path.id]) } : path),
      pathLinks: clone(snapshot.pathLinks).filter((link) => current.paths.some((path) => path.id === link.fromPathId) && current.paths.some((path) => path.id === link.toPathId)),
    });

    const undo = useCallback(() => {
      if (cancelEdit()) return;
      const H = hist.current;
      if (H.past.length) {
        const previous = H.past.pop();
        if (previous.waypointSnapshot) {
          H.future.push({ waypointSnapshot: waypointSnapshot(project) });
          setProject((current) => restoreWaypointSnapshot(current, previous.waypointSnapshot)); setPlanningInputRevision((value) => value + 1);
        } else { H.future.push(clone(docRef.current)); writeDoc(previous); }
        force((x) => x + 1); return;
      }
      const R = routineHist.current;
      if (R.past.length) {
        R.future.push(clone(routineState(project)));
        const previous = R.past.pop();
        setProject((current) => withRoutineState(current, previous));
        setRoutineSel(null); force((x) => x + 1); return;
      }
      const P = projectHist.current; if (!P.past.length) return;
      P.future.push({ project: clone(project), activeIdx });
      const previous = P.past.pop(); routineHist.current = { past: [], future: [] }; setProject(previous.project); setActiveIdx(previous.activeIdx); setSel({ kind: null, idx: -1 }); force((x) => x + 1);
    }, [cancelEdit, writeDoc, project, activeIdx]);
    const redo = useCallback(() => {
      if (cancelEdit()) return;
      const H = hist.current;
      if (H.future.length) {
        const next = H.future.pop();
        if (next.waypointSnapshot) {
          H.past.push({ waypointSnapshot: waypointSnapshot(project) });
          setProject((current) => restoreWaypointSnapshot(current, next.waypointSnapshot)); setPlanningInputRevision((value) => value + 1);
        } else { H.past.push(clone(docRef.current)); writeDoc(next); }
        force((x) => x + 1); return;
      }
      const R = routineHist.current;
      if (R.future.length) {
        R.past.push(clone(routineState(project)));
        const nextState = R.future.pop();
        setProject((current) => withRoutineState(current, nextState));
        setRoutineSel(null); force((x) => x + 1); return;
      }
      const P = projectHist.current; if (!P.future.length) return;
      P.past.push({ project: clone(project), activeIdx });
      const next = P.future.pop(); routineHist.current = { past: [], future: [] }; setProject(next.project); setActiveIdx(next.activeIdx); setSel({ kind: null, idx: -1 }); force((x) => x + 1);
    }, [cancelEdit, writeDoc, project, activeIdx]);

    const select = useCallback((kind, idx) => setSel(kind ? { kind, idx } : { kind: null, idx: -1 }), []);
    const moveWaypoint = useCallback((i, point) => mutate((path) => moveWaypointTo(path, i, point)), [mutate]);
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
    const applyBrush = useCallback((stroke) => {
      const result = applyBrushDraft(editStore, docRef.current, stroke);
      if (!result.changed) return false;
      syncBrushSelection(selRef, result.beforeWaypoints, result.path.waypoints, select);
      return true;
    }, [editStore, select]);
    const prepareWaypointInsertion = useCallback((rawPoint, segmentHint, onPath, selectedVisit) => {
      const p = clampWorld(rawPoint);
      const candidate = clone(docRef.current);
      const wps = candidate.waypoints, oldCount = wps.length;
      const pts = derived.sample.pts || [];
      const f = selectedVisit && Number.isFinite(selectedVisit.f)
        ? selectedVisit.f
        : (pts.length > 1 ? PM.nearestFraction(p.x, p.y, pts) : 0.5);
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
        : (onPath && pts.length > 1 ? PM.nearestPointOnSegment(p, pts, segment) : null);
      const projected = nearest || p;
      const originalType = (wps[segment] && wps[segment].segType) || 'bezier';
      const nw = { x: projected.x, y: projected.y, linked: true, thetaOn: false, theta: 0, stop: false, segType: originalType };
      if (wps[segment] && wps[segment].segmentHeadingMode) nw.segmentHeadingMode = wps[segment].segmentHeadingMode;
      if (wps[segment] && wps[segment].segmentFollowMode) nw.segmentFollowMode = wps[segment].segmentFollowMode;
      if (wps[segment] && wps[segment].segmentLookAt) nw.segmentLookAt = { ...wps[segment].segmentLookAt };
      let previewRequired = false;

      // The original cubic planners can be split exactly with de Casteljau,
      // preserving the authored curve instead of reshaping both neighboring spans.
      if (onPath && originalType === 'bezier' && (plannerId === 'profiledSpline' || plannerId === 'optimizedTrajectory')) {
        const a = wps[segment], b = wps[segment + 1], t = nearest && Number.isFinite(nearest.t) ? Math.max(0.001, Math.min(0.999, nearest.t)) : 0.5;
        if (a && b && a.nextC && b.prevC) {
          const split = PM.splitBezier(a, a.nextC, b.prevC, b, t);
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
        const hd = PM.autoHandles(wps, insertAt);
        nw.prevC = hd.prevC; nw.nextC = hd.nextC;
      }
      candidate._selAfter = insertAt;
      return { doc: candidate, index: insertAt, previewRequired, segmentType: originalType };
    }, [derived, plannerId]);

    const addWaypoint = useCallback((p, segmentHint, onPath, selectedVisit) => {
      const prepared = prepareWaypointInsertion(p, segmentHint, onPath, selectedVisit);
      if (prepared.previewRequired) {
        const message = 'Splitting this ' + prepared.segmentType + ' may rebuild its geometry. Review the dashed path first.';
        setWaypointPreviewRequest({ ...prepared, plannerId, message });
        return;
      }
      commit(() => prepared.doc);
    }, [commit, plannerId, prepareWaypointInsertion]);
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
      if (before.segmentFollowMode) end.segmentFollowMode = before.segmentFollowMode;
      else delete end.segmentFollowMode;
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

      if (segmentType === 'clothoid') {
        const message = 'The new clothoid join may rebuild the previous turn. Review the dashed path first.';
        setWaypointPreviewRequest({ doc: candidate, index: oldCount, plannerId, message, actionLabel: 'Place endpoint' });
        return;
      }
      commit(() => candidate);
    }, [commit, plannerId]);
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
      if (!PM.jigglePositions(anchor, physicalBaseRad, config, { w: FIELD_W, h: FIELD_H })) return false;
      commit((d) => {
        d.waypoints[d.waypoints.length - 1].jiggle = config;
        d.goalVel = 0;
        return d;
      });
      return true;
    }, [commit, derived]);
    const applyWaypointPreview = useCallback(() => {
      if (!waypointPreview?.derived) return;
      commit(() => waypointPreview.doc);
      setWaypointPreviewRequest(null);
    }, [commit, waypointPreview]);
    useEffect(() => { setWaypointPreviewRequest(null); }, [doc, robot, plannerId]);
    useEffect(() => { if (doc._selAfter != null) { select('wp', doc._selAfter); mutate((d) => { delete d._selAfter; return d; }); } }, [doc._selAfter]);

    const setWp = useCallback((i, patch) => commit((d) => {
      const w = d.waypoints[i];
      if (patch.x != null || patch.y != null) {
        const next = clampWorld({ x: patch.x != null ? patch.x : w.x, y: patch.y != null ? patch.y : w.y });
        moveWaypointTo(d, i, next);
        patch = { ...patch, x: next.x, y: next.y };
      }
      Object.assign(w, patch);
      if (patch.theta != null && i === 0) setWaypointFacing(d, i, patch.theta);
      return d;
    }), [commit]);
    const setWaypointPositionLink = (index, target) => {
      const before = materializeProject();
      finishEdit();
      const next = target
        ? PathLinks.linkPosition(before, doc.id, index, target.pathId, target.index, pathLinkId())
        : PathLinks.unlinkPosition(before, doc.id, index);
      commitWaypointProject(before, next);
    };
    const commitWaypointProject = (before, next) => {
      if (next === before) return;
      hist.current.past.push({ waypointSnapshot: waypointSnapshot(before) });
      if (hist.current.past.length > 80) hist.current.past.shift();
      hist.current.future = []; projectHist.current.future = [];
      setProject(next); setPlanningInputRevision((value) => value + 1);
      force((value) => value + 1);
    };
    const toggleTheta = useCallback((i, on) => commit((d) => { d.waypoints[i].thetaOn = on; return d; }), [commit]);
    const setHandleLen = useCallback((i, key, len) => commit((d) => { const w = d.waypoints[i]; const a = Math.atan2(w[key].y - w.y, w[key].x - w.x); w[key] = { x: w.x + Math.cos(a) * len, y: w.y + Math.sin(a) * len }; return d; }), [commit]);
    const delWp = useCallback((i) => { commit((d) => removeWaypoint(d, i)); select(null, -1); }, [commit, select]);

    const enableTargetsAtFraction = (d, f) => {
      const fractions = derived.wpFrac || PM.waypointFracs(d, derived.sample);
      let segment = 0;
      for (let i = 0; i < d.waypoints.length - 1; i++) {
        if (f >= (fractions[i] || 0) - 1e-6) segment = i;
      }
      segment = Math.max(0, Math.min(d.waypoints.length - 2, segment));
      d.waypoints[segment].segmentHeadingMode = 'targets';
    };
    const addTargetAt = useCallback((p, visitFraction) => commit((d) => {
      const pts = derived.sample.pts;
      const f = Number.isFinite(visitFraction) ? visitFraction : (pts.length > 1 ? PM.nearestFraction(p.x, p.y, pts) : 0.5);
      const deg = pts.length > 1 ? PM.pointAtFraction(f, pts).heading * 180 / Math.PI : 0;
      d.targets.push({ f, deg });
      enableTargetsAtFraction(d, f);
      d._selT = d.targets.length - 1;
      return d;
    }), [commit, derived]);
    const addMarkerAt = useCallback((p, visitFraction) => commit((d) => { const f = Number.isFinite(visitFraction) ? visitFraction : (derived.sample.pts.length > 1 ? PM.nearestFraction(p.x, p.y, derived.sample.pts) : 0.5); d.markers.push({ id: markerId(), f, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit, derived]);
    useEffect(() => { if (doc._selT != null) { select('rt', doc._selT); mutate((d) => { delete d._selT; return d; }); } }, [doc._selT]);
    useEffect(() => { if (doc._selM != null) { select('em', doc._selM); mutate((d) => { delete d._selM; return d; }); } }, [doc._selM]);

    const moveTargetTo = useCallback((i, p, visitFraction) => mutate((d) => { const t = d.targets[i]; if (!t) return d; const f = Number.isFinite(visitFraction) ? visitFraction : PM.nearestFraction(p.x, p.y, derived.sample.pts); t.f = f; if (t.anchor === 'dist') t.d = +(f * (derived.sample.length || 0)).toFixed(3); return d; }), [mutate, derived]);
    const rotateTargetTo = useCallback((i, p, snap) => mutate((d) => {
      const target = d.targets[i]; if (!target) return d;
      const f = PM.featureFraction(target, derived.sample);
      const center = PM.pointAtFraction(f, derived.sample.pts);
      let deg = Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI;
      if (snap) deg = Math.round(deg / 15) * 15;
      target.deg = Math.round(deg * 10) / 10;
      return d;
    }), [mutate, derived]);
    const moveMarkerTo = useCallback((i, p, visitFraction) => mutate((d) => { const m = d.markers[i]; if (!m) return d; const f = Number.isFinite(visitFraction) ? visitFraction : PM.nearestFraction(p.x, p.y, derived.sample.pts); m.f = f; if (m.anchor === 'dist') m.d = +(f * (derived.sample.length || 0)).toFixed(3); return d; }), [mutate, derived]);
    const setFeature = (items, i, patch) => { const item = items[i]; if (!item) return; if (patch.anchor) { const f = PM.featureFraction(item, derived.sample); item.f = f; if (patch.anchor === 'dist') item.d = +(f * (derived.sample.length || 0)).toFixed(3); else delete item.d; } Object.assign(item, patch); };
    const setTarget = useCallback((i, patch) => commit((d) => { setFeature(d.targets, i, patch); return d; }), [commit, derived]);
    const delTarget = useCallback((i) => { commit((d) => { d.targets.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);
    const setMarker = useCallback((i, patch) => commit((d) => { setFeature(d.markers, i, patch); return d; }), [commit, derived]);
    const delMarker = useCallback((i) => { commit((d) => { d.markers.splice(i, 1); return d; }); select(null, -1); }, [commit, select]);

    const addRange = useCallback((f0, f1) => commit((d) => {
      if (!d.ranges) d.ranges = [];
      const a = Math.max(0, Math.min(f0, f1)), b = Math.min(1, Math.max(f0, f1));
      const c = PM.effectiveConstraints(d.constraints, robot);
      // purely where it was drawn (percent of path), inheriting the robot limits
      d.ranges.push({ f0: a, f1: b, anchor: 'param', maxVel: c.maxVel, maxAccel: c.maxAccel, maxDecel: (c.maxDecel != null ? c.maxDecel : c.maxAccel), maxAngVel: c.maxAngVel, maxAngAccel: c.maxAngAccel });
      d._selR = d.ranges.length - 1; return d;
    }), [commit, robot]);
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
        const fractions = PM.waypointFracs(d, derived.sample);
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
        const wf = PM.waypointFracs(d, derived.sample);
        const local = localRangeEndpoint(cf, wf);
        rg[which ? 'w1' : 'w0'] = local.waypoint; rg[which ? 't1' : 't0'] = local.local;
      }
      else { rg[key] = cf; }
      return d;
    }), [mutate, derived]);
    useEffect(() => { if (doc._selR != null) { select('cr', doc._selR); mutate((d) => { delete d._selR; return d; }); } }, [doc._selR]);

    const setConstraint = useCallback((patch) => commit((d) => { Object.assign(d.constraints, patch); return d; }), [commit]);
    const setDoc = useCallback((patch) => commit((d) => Object.assign(d, patch)), [commit]);
    const setRobot = useCallback((patch) => {
      setPlanningInputRevision((revision) => revision + 1);
      setProject((pr) => ({ ...pr, robot: { ...pr.robot, ...patch } }));
    }, []);

    const addTargetMid = useCallback(() => commit((d) => {
      const pts = derived.sample.pts;
      const deg = pts.length > 1 ? PM.pointAtFraction(0.5, pts).heading * 180 / Math.PI : 0;
      d.targets.push({ f: 0.5, deg });
      enableTargetsAtFraction(d, 0.5);
      d._selT = d.targets.length - 1;
      return d;
    }), [commit, derived]);
    const addMarkerMid = useCallback(() => commit((d) => { d.markers.push({ id: markerId(), f: 0.5, name: 'event' + (d.markers.length + 1), cmd: 'none', group: 'sequential' }); d._selM = d.markers.length - 1; return d; }), [commit]);
    const addRangeMid = useCallback(() => addRange(0.35, 0.6), [addRange]);

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
    const nudgeWp = useCallback((i, dx, dy) => commit((path) => {
      const waypoint = path.waypoints[i];
      return waypoint ? moveWaypointTo(path, i, { x: waypoint.x + dx, y: waypoint.y + dy }) : path;
    }), [commit]);
    const nudgeFrac = useCallback((kind, i, df) => commit((d) => {
      const arr = kind === 'rt' ? d.targets : d.markers; const item = arr[i]; if (!item) return d;
      const f = Math.max(0, Math.min(1, PM.featureFraction(item, derived.sample) + df));
      item.f = f; if (item.anchor === 'dist') item.d = +(f * (derived.sample.length || 0)).toFixed(3);
      return d;
    }), [commit, derived]);
    const setWaypointHeading = useCallback((i, deg) => mutate((d) => setWaypointFacing(d, i, deg)), [mutate]);
    const faceWaypoint = useCallback((i, mode) => commit((d) => {
      const w = d.waypoints[i]; let deg = w.theta || 0;
      if (mode === 'next' && d.waypoints[i + 1]) { const t = d.waypoints[i + 1]; deg = Math.atan2(t.y - w.y, t.x - w.x) * 180 / Math.PI; }
      else if (mode === 'prev' && d.waypoints[i - 1]) { const t = d.waypoints[i - 1]; deg = Math.atan2(t.y - w.y, t.x - w.x) * 180 / Math.PI; }
      else if (mode === 'tangent') { const idx = (derived.wpIdx && derived.wpIdx[i]) || 0; const p = derived.sample.pts[idx]; if (p) deg = (p.heading || 0) * 180 / Math.PI; }
      return setWaypointFacing(d, i, deg - (i === 0 && d.driveBackward ? 180 : 0));
    }), [commit, derived]);
    const headingMenu = useCallback((i, x, y, returnFocus) => {
      setHeadMenu({ x, y, returnFocus, items: [
        { label: 'Face next waypoint', icon: 'compass', onClick: () => faceWaypoint(i, 'next') },
        { label: 'Face previous waypoint', icon: 'compass', onClick: () => faceWaypoint(i, 'prev') },
        { label: 'Align to path tangent', icon: 'route', onClick: () => faceWaypoint(i, 'tangent') },
        { sep: true },
        { label: 'Type exact angle\u2026', icon: 'compass', onClick: () => { setOptimizationOpen(false); setComparison(null); setInspectorOpen(true); select('wp', i); } },
      ] });
    }, [faceWaypoint, select]);
    const duplicateWp = useCallback((i) => commit((d) => duplicateWaypoint(d, i)), [commit]);
    const reversePath = useCallback(() => reverseDistance == null ? undefined : commit((path) => { reversePathDraft(path); return PM.reversePathAnchors(path, reverseDistance); }), [commit, reverseDistance]);
    const reorderWp = useCallback((from, to) => commit((d) => reorderWaypoint(d, from, to)), [commit]);
    const insertWp = useCallback((i) => {
      const pts = derived.sample.pts;
      if (!pts || pts.length < 2) return;
      const lo = derived.wpFrac && Number.isFinite(derived.wpFrac[i]) ? derived.wpFrac[i] : i / Math.max(1, doc.waypoints.length - 1);
      const hi = derived.wpFrac && Number.isFinite(derived.wpFrac[i + 1]) ? derived.wpFrac[i + 1] : (i + 1) / Math.max(1, doc.waypoints.length - 1);
      addWaypoint(PM.pointAtFraction((lo + hi) / 2, pts), i, true);
    }, [addWaypoint, derived, doc.waypoints.length]);
    const inspActions = { setWp, toggleTheta, setHandleLen, delWp, setTarget, delTarget, setMarker, delMarker, setRange, setRangeAnchor, delRange, setConstraint, setDoc, select, setTool,
      addTargetMid, addMarkerMid, addRangeMid,
      setSegMeta, setSegmentHeadingMode, setSegmentLookAt, setJiggle, faceWaypoint, duplicateWp, reversePath, canReversePath: reverseDistance != null, reorderWp, insertWp,
      setStop, setWait, setTurnInPlace, setTurnInPlaceMeta, setHeadingMode, toggleDriveBackward,
      openInspector: () => setInspectorOpen(true) };
    const fieldActions = { addWaypoint, appendWaypoint, moveWaypoint, moveHandle, applyBrush, addTargetAt, addMarkerAt, moveTargetTo, rotateTargetTo, moveMarkerTo, addRange, moveRangeHandle, beginEdit, finishEdit, cancelEdit,
      setWaypointHeading, moveSegmentLookAt, headingMenu, faceWaypoint, delWp, delTarget, delMarker, delRange,
      openInspector: () => setInspectorOpen(true),
      select };

    const uniquePathName = (base) => uniqueItemName(project.paths, base);
    const resetForPath = (i) => {
      finishEdit();
      routinePlaybackStore.reset();
      if (i !== activeIdx) setPlanningInputRevision(0);
      setActiveIdx(i); setSel({ kind: null, idx: -1 }); playbackStore.reset();
      hist.current = { past: [], future: [] }; setPage('plan');
    };
    const updatePathLibrary = (update) => {
      finishEdit();
      setProject(update);
    };
    const addPath = (folderId) => {
      finishEdit();
      const name = uniquePathName('New path'), index = project.paths.length;
      const path = blankPath(name, robot); if (folderId) path.folderId = folderId;
      setProject((pr) => ({ ...pr, paths: [...pr.paths, path] })); resetForPath(index);
      return { index, name, id: path.id, folderId: path.folderId };
    };
    const appendPath = (sourceId) => {
      const paths = materializeProject().paths;
      const source = sourceId ? paths.find((path) => path.id === sourceId) : paths[activeIdx]; if (!source) return null;
      finishEdit();
      const name = uniquePathName('New path'), index = project.paths.length, path = blankPath(name, robot);
      const start = source.waypoints[source.waypoints.length - 1], angle = (start.theta || 0) * Math.PI / 180;
      let end = clampWorld({ x: start.x + Math.cos(angle) * 2.8, y: start.y + Math.sin(angle) * 2.8 });
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.75) {
        const towardCenter = Math.atan2(FIELD_H / 2 - start.y, FIELD_W / 2 - start.x);
        end = clampWorld({ x: start.x + Math.cos(towardCenter) * 2.8, y: start.y + Math.sin(towardCenter) * 2.8 });
      }
      path.waypoints = buildWps([{ x: start.x, y: start.y, theta: start.theta || 0 }, { x: end.x, y: end.y, theta: start.theta || 0 }]);
      if (source.folderId) path.folderId = source.folderId;
      const link = { id: pathLinkId(), fromPathId: source.id, toPathId: path.id };
      setProject((pr) => ({ ...pr, paths: [...pr.paths, path], pathLinks: [...(pr.pathLinks || []).filter((item) => item.fromPathId !== source.id), link] }));
      resetForPath(index); return { index, name, id: path.id, folderId: path.folderId };
    };
    const setPathLink = (fromPathId, toPathId) => {
      const pr = materializeProject(); finishEdit();
      let pathLinks = (pr.pathLinks || []).filter((link) => link.fromPathId !== fromPathId);
      if (!toPathId || fromPathId === toPathId) { commitWaypointProject(pr, { ...pr, pathLinks }); return; }
      pathLinks = pathLinks.filter((link) => link.toPathId !== toPathId);
      const paths = pr.paths.slice(), source = paths.find((path) => path.id === fromPathId), targetIndex = paths.findIndex((path) => path.id === toPathId);
      if (!source || targetIndex < 0) return;
      const target = clone(paths[targetIndex]), end = source.waypoints[source.waypoints.length - 1];
      target.waypoints[0] = PathLinks.copyPose(target.waypoints[0], end); paths[targetIndex] = target;
      const next = { ...pr, paths, pathLinks: [...pathLinks, { id: pathLinkId(), fromPathId, toPathId }] };
      commitWaypointProject(pr, PathLinks.sync(next, target.id, pr.paths[targetIndex]));
    };
    const dupPath = (i) => {
      const source = materializeProject().paths[i]; if (!source) return null;
      finishEdit();
      const name = uniquePathName(source.name + ' copy'), index = i + 1;
      const cp = duplicatePathForLibrary(source, name);
      setProject((pr) => { const paths = pr.paths.slice(); paths.splice(index, 0, cp); return { ...pr, paths }; });
      resetForPath(index); return { index, name, id: cp.id, folderId: cp.folderId };
    };
    const delPath = (i) => {
      if (project.paths.length <= 1) return false;
      const target = project.paths[i]; if (!target) return false;
      const references = referencingRoutines(routines, target.id);
      if (references.length) { alert('“' + target.name + '” is used by ' + references.map((candidate) => candidate.name).join(', ') + '. Remove those steps before deleting the path.'); return false; }
      if (!confirm('Delete path “' + target.name + '”? This cannot be undone.')) return false;
      updatePathLibrary((pr) => { const paths = pr.paths.filter((_, k) => k !== i); return { ...pr, paths, pathLinks: (pr.pathLinks || []).filter((link) => link.fromPathId !== target.id && link.toPathId !== target.id) }; });
      setActiveIdx((a) => Math.max(0, a > i ? a - 1 : a === i ? Math.min(a, project.paths.length - 2) : a));
      setSel({ kind: null, idx: -1 }); playbackStore.reset(); hist.current = { past: [], future: [] };
      return true;
    };
    const renamePath = (i, name) => { const clean = (name || '').trim(); if (!clean) return false; updatePathLibrary((pr) => { const paths = pr.paths.slice(); paths[i] = { ...paths[i], name: clean }; return { ...pr, paths }; }); return true; };
    const addPathFolder = () => {
      const folders = project.pathFolders || [], name = uniqueItemName(folders, 'New folder');
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
      updatePathLibrary((pr) => ({ ...pr, pathFolders: (pr.pathFolders || []).filter((candidate) => candidate.id !== id), paths: pr.paths.map((path) => path.folderId === id ? (() => { const next = { ...path }; delete next.folderId; return next; })() : path) }));
      return true;
    };
    const movePathToFolder = (i, folderId) => updatePathLibrary((pr) => ({ ...pr, paths: pr.paths.map((path, index) => {
      if (index !== i) return path; const next = { ...path }; if (folderId) next.folderId = folderId; else delete next.folderId; return next;
    }) }));
    const setActive = (i) => { if (i === activeIdx && page === 'plan') return; setComparison(null); resetForPath(i); };
    const resetForRoutine = () => {
      setRoutineSel(null); routinePlaybackStore.reset(); setRoutineOutcomes({});
    };
    const uniqueRoutineName = (base) => uniqueItemName(routines, base);
    const setActiveRoutine = (id) => {
      if (id === routine.id && page === 'auto') return;
      finishEdit(); playbackStore.reset();
      if (!routines.some((candidate) => candidate.id === id)) return;
      setProject((current) => withRoutineState(current, { ...routineState(current), activeRoutineId: id }));
      routineHist.current = { past: [], future: [] }; resetForRoutine(); setPage('auto');
    };
    const addRoutine = () => {
      finishEdit(); playbackStore.reset();
      const created = blankRoutine(uniqueRoutineName('New routine'));
      commitRoutineState((state) => ({ routines: [...state.routines, created], activeRoutineId: created.id }));
      resetForRoutine(); setPage('auto'); return created;
    };
    const duplicateRoutine = (id) => {
      const source = routines.find((candidate) => candidate.id === id); if (!source) return null;
      const created = { ...clone(source), id: routineId(), name: uniqueRoutineName(source.name + ' copy') };
      commitRoutineState((state) => { const index = state.routines.findIndex((candidate) => candidate.id === id); const next = state.routines.slice(); next.splice(index + 1, 0, created); return { routines: next, activeRoutineId: created.id }; });
      resetForRoutine(); return created;
    };
    const deleteRoutine = (id) => {
      if (routines.length <= 1) return false;
      const target = routines.find((candidate) => candidate.id === id); if (!target) return false;
      if (!confirm('Delete routine “' + target.name + '”? This cannot be undone.')) return false;
      commitRoutineState((state) => { const index = state.routines.findIndex((candidate) => candidate.id === id); const next = state.routines.filter((candidate) => candidate.id !== id); const activeRoutineId = state.activeRoutineId === id ? next[Math.min(index, next.length - 1)].id : state.activeRoutineId; return { routines: next, activeRoutineId }; });
      resetForRoutine(); return true;
    };
    const renameRoutine = (id, name) => {
      const clean = (name || '').trim(); if (!clean) return false;
      commitRoutineState((state) => ({ ...state, routines: state.routines.map((candidate) => candidate.id === id ? { ...candidate, name: clean } : candidate) })); return true;
    };
    const agentCandidates = agentProposal && Array.isArray(agentProposal.candidates) ? agentProposal.candidates : [];
    const agentCandidate = agentCandidates.find((candidate) => candidate.id === agentCandidateId) || agentCandidates[0] || null;
    const agentPreviewRequest = useMemo(() => agentCandidate?.path ? { candidate: agentCandidate, robot, plannerId } : null, [agentCandidate, robot, plannerId]);
    useEffect(() => {
      if (agentProposal?.status === 'ready' && agentPreviewRequest) {
        agentPreviewer.request({ key: agentPreviewRequest, path: agentPreviewRequest.candidate.path, robot, plannerId, quality: 'final' });
      }
    }, [agentPreviewer, agentProposal, agentPreviewRequest, robot, plannerId]);
    const agentProposalPreview = agentProposalPreviewResult(agentPreview, agentCandidate, agentPreviewRequest, plannerId);
    const agentProposalCanApplyCandidate = canApplyAgentProposalCandidate(agentProposal, agentCandidate, agentProposalPreview);
    const rejectAgentProposal = useCallback(() => {
      if (!agentProposal) return;
      if (window.bordeauxAPI && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(agentProposal.id, 'rejected');
      const rejected = { ...agentProposal, status: 'rejected' };
      agentProposalRef.current = rejected;
      setAgentProposal(rejected);
    }, [agentProposal]);
    const applyAgentProposal = useCallback(() => {
      const proposalContext = agentProposalContext.current;
      const publishedContext = agentPublishedContext.current;
      const currentActivePathId = docRef.current && docRef.current.id;
      const contextMatches = agentProposalMatchesPublishedContext(agentProposal, agentSessionId, publishedContext, {
        project: projectRef.current,
        activePathId: currentActivePathId,
        editRevision: editStore.getRevision(),
        javaCatalogFingerprint: javaCatalogFingerprint.current,
        hasDraft: Boolean(editStore.getSnapshot()),
      });
      if (!agentProposal || agentProposal.status !== 'ready' || !contextMatches
        || !proposalContext || proposalContext.published !== publishedContext || proposalContext.id !== agentProposal.id
        || javaProjectState.operation || !agentProposalCanApplyCandidate
        || (agentProposal.blockingIssues && agentProposal.blockingIssues.length)) return;
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
        const paths = project.paths.slice(), beforePath = paths[nextIndex]; paths[nextIndex] = replacement;
        nextProject = PathLinks.sync({ ...project, paths }, replacement.id, beforePath);
      } else {
        nextIndex = project.paths.length;
        nextProject = { ...project, paths: [...project.paths, clone(agentCandidate.path)] };
      }
      projectHist.current.past.push(before); if (projectHist.current.past.length > 80) projectHist.current.past.shift(); projectHist.current.future = [];
      setProject(nextProject); if (agentProposal.operation !== 'configureRobot') resetForPath(nextIndex); updateDirty(true);
      if (window.bordeauxAPI && window.bordeauxAPI.updateAgentProposalStatus) window.bordeauxAPI.updateAgentProposalStatus(agentProposal.id, 'applied', agentRevision.current + 1);
      const applied = { ...agentProposal, status: 'applied', appliedRevision: agentRevision.current + 1 };
      agentProposalRef.current = applied;
      setAgentProposal(applied);
    }, [agentProposal, agentCandidate, agentProposalCanApplyCandidate, project, activeIdx, agentSessionId, editStore, javaProjectState.operation, updateDirty]);

    const total = derived.prof.totalTime || 0;
    useEffect(() => playbackStore.setTotal(total), [playbackStore, total]);

    const routinePlanningPaths = useMemo(() => {
      const referenced = new Map();
      AUTO.walk(routine.nodes, (node) => {
        if (node.type === 'path') {
          const path = project.paths.find((candidate) => candidate.id === node.ref);
          if (path) referenced.set(path.id, path);
        } else if (node.type === 'function' && node.cat === 'generate' && node.preview) {
          referenced.set(node.preview.id, node.preview);
        }
      });
      return [...referenced.values()];
    }, [routine, project.paths]);
    const routinePlans = useRoutinePlanning(page === 'auto', routinePlanningPaths, robot, plannerId);
    const lastRun = useRef({ steps: [], total: 0 });
    const run = useMemo(() => {
      if (page !== 'auto') return lastRun.current;
      const nextRun = AUTO.buildRun(routine, project.paths, robot, routineOutcomes, plannerId, javaProjectState.catalog, routinePlans);
      lastRun.current = nextRun;
      return nextRun;
    }, [page, routine, project.paths, robot, routineOutcomes, plannerId, javaProjectState.catalog, routinePlans]);
    useEffect(() => routinePlaybackStore.setTotal(run.total), [routinePlaybackStore, run.total]);
    useEffect(() => { if (page !== 'plan') playbackStore.pause(); if (page !== 'auto') routinePlaybackStore.pause(); }, [page, playbackStore, routinePlaybackStore]);

    const acq = useMemo(() => ({
      outcomes: routineOutcomes,
      set: (id, patch) => setRoutine((r) => AUTO.update(r, id, patch)),
      del: (id) => {
        const node = AUTO.findNode(routine, id);
        const label = node ? AUTO.nodeTitle(node, project.paths, javaProjectState.catalog) : 'this routine step';
        if (!confirm('Delete “' + label + '” from the routine? Decision branches beneath it will also be removed.')) return;
        setRoutine((r) => AUTO.remove(r, id)); setRoutineSel(null);
      },
      move: (id, dir) => setRoutine((r) => AUTO.move(r, id, dir)),
      reorder: (id, targetId, before) => setRoutine((r) => AUTO.reorderRelative(r, id, targetId, before)),
      select: (id) => setRoutineSel(id),
      addAfter: (id, type, cat) => setRoutine((r) => { const nn = AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return AUTO.insertAfter(r, id, nn); }),
      addBranch: (decId, br, type, cat) => setRoutine((r) => { const nn = AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return AUTO.appendBranch(r, decId, br, nn); }),
      addEnd: (type, cat) => setRoutine((r) => { const nn = AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return AUTO.append(r, nn); }),
      prepend: (type, cat) => setRoutine((r) => { const nn = AUTO.newNode(type, cat, project.paths[0].id); setRoutineSel(nn.id); return AUTO.prepend(r, nn); }),
      setOutcome: (id, br) => setRoutineOutcomes((o) => ({ ...o, [id]: br })),
      openInEditor: (id) => { const idx = project.paths.findIndex((path) => path.id === id); if (idx >= 0) { setActive(idx); setPage('plan'); } },
    }), [routineOutcomes, routine, project.paths, javaProjectState.catalog]);
    const autoFieldActions = useMemo(() => ({ selectNode: (id) => setRoutineSel((s) => s === id ? null : id), select: () => setRoutineSel(null) }), []);

    const onFit = useCallback(() => setView(FIT), []);
    const zoomBy = useCallback((factor) => setView((v) => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const nw = Math.max(IMG_W * 0.12, Math.min(IMG_W * 1.6, v.w * factor));
      const nh = nw * (IMG_H / IMG_W);
      return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    }), []);
    const zoomPct = Math.round(FIT.w / view.w * 100);
    const compareTrajectory = (mode) => {
      if (mode === 'normal' && !normalReady) return;
      playbackStore.reset();
      setComparison({ id: doc.id, key: optimizationKey, mode });
    };
    const toggleOptimization = () => {
      if (optimizationOpen) {
        compareTrajectory('selected');
        setOptimizationOpen(false);
        return;
      }
      setOptimizationOpen(true);
      if (normalReady && !accepted && !candidate && !optimizationState.running) {
        setComparison(null);
        void optimizer.start(doc.id, 'common');
      }
    };
    const startOptimization = (deadline) => {
      setComparison(null);
      void optimizer.start(doc.id, deadline);
    };
    const setCorridor = (value) => {
      if (!Number.isFinite(value)) return;
      const corridorM = Math.max(0.03, Math.min(1.5, value));
      if (Math.abs(corridorM - (doc.optimization?.corridorM ?? 0.15)) < 1e-9) return;
      beginHistory();
      playbackStore.reset();
      writeDoc({ ...doc, optimization: { ...doc.optimization, corridorM } });
    };
    const applyOptimization = () => {
      if (!candidate?.finalTrajectory || editStore.getSnapshot()) return;
      const current = projectRef.current;
      const currentPath = current.paths.find((path) => path.id === doc.id);
      if (!currentPath || optimizationInputKey(currentPath, current.robot, current.field) !== optimizationKey) return;
      try {
        const result = { version: 1, inputKey: optimizationKey, samplesPerSegment: PERSEG, result: clone(candidate.finalTrajectory) };
        appliedPreview.current = { artifact: result, key: optimizationKey, value: candidate };
        beginHistory();
        playbackStore.reset();
        setComparison(null);
        writeDoc({ ...currentPath, optimization: { corridorM: currentPath.optimization?.corridorM ?? 0.15, accepted: result } });
      } catch (error) { setExportError(error.message || 'The candidate could not be applied.'); }
    };
    const useNormalTrajectory = () => {
      beginHistory();
      playbackStore.reset();
      setComparison(null);
      writeDoc({ ...doc, optimization: { corridorM: doc.optimization?.corridorM ?? 0.15 } });
    };

    // ---- desktop project workflow ----
    const canReplaceProject = useCallback(() => flushProjectDraft()
      && (!dirtyRef.current || confirm('Discard unsaved changes to this project?')), [flushProjectDraft]);
    const loadProject = useCallback((incoming) => {
      invalidateScheduledAutosave();
      cancelEdit();
      optimizer.cancel();
      setComparison(null);
      const next = normalizeProject(incoming);
      setProjectKey((key) => key + 1);
      setLibraryPreferenceKey(next.name + ':' + next.paths[0].id);
      const javaGeneration = ++javaRestoreGeneration.current;
      const requestedPathId = next.editor && next.editor.activePathId;
      const requestedPathIndex = requestedPathId ? next.paths.findIndex((path) => path.id === requestedPathId) : -1;
      skipDirty.current = true;
      projectRef.current = next;
      setPlanningInputRevision(0);
      setProject(next);
      setActiveIdx(requestedPathIndex >= 0 ? requestedPathIndex : 0); setSel({ kind: null, idx: -1 }); setRoutineSel(null);
      playbackStore.reset();
      routinePlaybackStore.reset();
      setExportError('');
      hist.current = { past: [], future: [] };
      routineHist.current = { past: [], future: [] };
      projectHist.current = { past: [], future: [] };
      updateDirty(false);
      setJavaProjectState((current) => ({ ...current, status: 'unlinked', operation: null, catalog: null, integration: null, bookmarkId: null, error: '', notice: '' }));
      if (next.editor && next.editor.javaProjectBookmarkId) void openRecentJavaProject(next.editor.javaProjectBookmarkId, javaGeneration);
    }, [cancelEdit, invalidateScheduledAutosave, openRecentJavaProject, playbackStore, routinePlaybackStore, updateDirty]);
    useEffect(() => {
      let active = true;
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.restoreLastProject !== 'function') return undefined;
      const sourceProject = projectRef.current;
      const editRevision = editStore.getRevision();
      void enqueuePersistence(() => window.bordeauxAPI.restoreLastProject()).then(async (result) => {
        if (!active || !result) return;
        if (sourceProject !== projectRef.current || editRevision !== editStore.getRevision() || dirtyRef.current) {
          invalidateScheduledAutosave();
          await window.bordeauxAPI.newProject();
          updateDirty(true);
          return;
        }
        loadProject(result.project);
      }).catch((error) => console.warn('Could not restore the last project:', error));
      return () => { active = false; };
    }, [editStore, enqueuePersistence, invalidateScheduledAutosave, loadProject, updateDirty]);
    const prepareProjectReplacement = useCallback(() => {
      invalidateScheduledAutosave();
      cancelEdit();
    }, [cancelEdit, invalidateScheduledAutosave]);
    const newProject = useCallback(() => {
      return enqueuePersistenceAfterPreflight(enqueuePersistence, canReplaceProject, async () => {
        prepareProjectReplacement();
        if (window.bordeauxAPI) await window.bordeauxAPI.newProject();
        loadProject(freshProject());
      });
    }, [canReplaceProject, enqueuePersistence, loadProject, prepareProjectReplacement]);
    const openProject = useCallback((recentIndex) => {
      if (!window.bordeauxAPI) return;
      return enqueuePersistenceAfterPreflight(enqueuePersistence, canReplaceProject, async () => {
        prepareProjectReplacement();
        try {
          const result = typeof recentIndex === 'number'
            ? await window.bordeauxAPI.openRecentProject(recentIndex)
            : await window.bordeauxAPI.openProject();
          if (result) loadProject(result.project);
        } catch (error) {
          alert('Could not open project: ' + (error && error.message ? error.message : error));
        }
      });
    }, [canReplaceProject, enqueuePersistence, loadProject, prepareProjectReplacement]);
    const saveProject = useCallback((saveAs) => {
      if (!window.bordeauxAPI) return;
      return enqueuePersistenceAfterPreflight(enqueuePersistence, flushProjectDraft, async () => {
        const requestedDraftGeneration = draftInputGeneration.current;
        try {
          const source = { project: projectRef.current, editRevision: editStore.getRevision(), draftGeneration: requestedDraftGeneration };
          const result = await window.bordeauxAPI.saveProject(materializeProject(), saveAs === true);
          if (result && result.canceled) return;
          if (projectPersistenceStayedCurrent(source, {
            project: projectRef.current,
            editRevision: editStore.getRevision(),
            draftGeneration: draftInputGeneration.current,
          })) updateDirty(false);
        } catch (error) {
          alert('Could not save project: ' + (error && error.message ? error.message : error));
        }
      });
    }, [editStore, enqueuePersistence, flushProjectDraft, materializeProject, updateDirty]);

    const onExportJava = useCallback(async (destination) => {
      if (!flushProjectDraft()) return;
      if (!window.bordeauxAPI || typeof window.bordeauxAPI.exportJava !== 'function') {
        setExportError('Java trajectory export is available in the Bordeaux desktop app.');
        return;
      }
      if (!javaProjectState.catalog) {
        setExportError('Link a Java robot project before exporting Java trajectory JSON.');
        return;
      }
      setExportError('');
      setJavaProjectState((current) => ({ ...current, operation: 'export', error: '', notice: '' }));
      try {
        const result = await window.bordeauxAPI.exportJava(materializeProject(), destination === 'saveAs' ? 'saveAs' : 'linked');
        setJavaProjectState((current) => ({
          ...current,
          operation: null,
          notice: result && result.exported ? 'Exported Java trajectory to ' + result.relativePath + '.' : '',
        }));
        setExportError('');
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        setJavaProjectState((current) => ({ ...current, operation: null }));
        setExportError(message);
      }
    }, [flushProjectDraft, javaProjectState.catalog, materializeProject]);

    useEffect(() => {
      if (!window.bordeauxAPI) return undefined;
      return window.bordeauxAPI.onMenuCommand(({ command, payload }) => {
        if (command === 'new-project') void newProject();
        else if (command === 'open-project') void openProject();
        else if (command === 'open-recent') void openProject(payload);
        else if (command === 'save-project') void saveProject(false);
        else if (command === 'save-project-as') void saveProject(true);
        else if (command === 'export-java') void onExportJava('linked');
        else if (command === 'export-java-save-as') void onExportJava('saveAs');
        else if (command === 'java-link') void linkJavaProject();
        else if (command === 'java-install') void installJavaSupport();
        else if (command === 'java-build') void buildJavaCatalog();
        else if (command === 'java-cancel-build') void cancelJavaCatalogBuild();
      });
    }, [newProject, openProject, saveProject, onExportJava, linkJavaProject, installJavaSupport, buildJavaCatalog, cancelJavaCatalogBuild]);

    useEffect(() => {
      const onKey = (e) => {
        if (e.defaultPrevented || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
        if (e.target.closest && e.target.closest('.editor-library,.library-divider,[role="menu"]')) return;
        const matches = e.target.matches && e.target.matches.bind(e.target);
        if (e.key === 'Tab') { keyboardNavigation.current = true; return; }
        const nativeKeyboardControl = keyboardNavigation.current && matches && matches('button,select,input[type="range"]');
        const textEditing = nativeKeyboardControl || e.target.isContentEditable || (matches && matches('textarea,input:not([type="range"])'));
        const k = e.key.toLowerCase();
        if (page === 'plan' && e.key === ' ' && !textEditing) {
          e.preventDefault();
          if (e.repeat) return;
          if (typeof e.target.blur === 'function') e.target.blur();
          playbackStore.toggle();
          return;
        }
        const toolShortcut = !e.metaKey && !e.ctrlKey && !e.altKey && !textEditing && ({ '1': 'select', '2': 'waypoint', '3': 'rotation', '4': 'marker', '5': 'range', '6': 'brush', v: 'select', w: 'waypoint', r: 'rotation', m: 'marker', c: 'range', b: 'brush' })[k];
        if (page === 'plan' && toolShortcut) {
          e.preventDefault();
          if (typeof e.target.blur === 'function') e.target.blur();
          setTool(toolShortcut);
          return;
        }
        const formControl = matches && matches('input,select,textarea,[contenteditable="true"]');
        if (formControl) return;
        // Bracket radius nudges sit below the form-control guard so a focused field
        // (including .numinput, which tool shortcuts deliberately pass through) keeps its
        // keystrokes. FieldView's visit cycling binds the same keys in the capture phase,
        // so defer to it when it claimed the event.
        if (page === 'plan' && tool === 'brush' && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '[' || e.key === ']')) {
          e.preventDefault();
          const direction = e.key === ']' ? 1 : -1;
          setBrush((current) => ({ ...current, radius: Math.max(0.3, Math.min(2.4, +(current.radius + direction * 0.1).toFixed(1))) }));
          return;
        }
        if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if ((e.metaKey || e.ctrlKey) && k === 'y') { e.preventDefault(); redo(); return; }
        if (page !== 'plan') return;
        if (!derivationCurrent) return;
        if (e.key.indexOf('Arrow') === 0 && sel.kind) {
          const base = e.shiftKey ? 0.25 : e.altKey ? 0.01 : 0.05;
          let dx = 0, dy = 0;
          if (e.key === 'ArrowUp') dy = base; else if (e.key === 'ArrowDown') dy = -base;
          else if (e.key === 'ArrowRight') dx = base; else if (e.key === 'ArrowLeft') dx = -base;
          if (dx || dy) {
            e.preventDefault();
            if (sel.kind === 'wp') nudgeWp(sel.idx, dx, dy);
            else if (sel.kind === 'rt' || sel.kind === 'em') { const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1; nudgeFrac(sel.kind, sel.idx, dir * (e.shiftKey ? 0.02 : 0.005)); }
          }
          return;
        }
        if (k === 'g') setShowGrid((s) => !s);
        else if (k === 'f') setView(FIT);
        else if (e.key === 'Escape') { setTool('select'); setHeadMenu(null); setWaypointPreviewRequest(null); select(null, -1); }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && sel.kind) {
          if (sel.kind === 'wp') delWp(sel.idx); else if (sel.kind === 'rt') delTarget(sel.idx); else if (sel.kind === 'em') delMarker(sel.idx); else if (sel.kind === 'cr') delRange(sel.idx);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo, sel, delWp, delTarget, delMarker, delRange, select, page, tool, derivationCurrent, nudgeWp, nudgeFrac, playbackStore]);

    const pathIndex = (id) => project.paths.findIndex((path) => path.id === id);
    const renderLibrary = (mode, structure) => h(LibraryRail, {
      key: projectKey + ':' + mode, preferenceKey: libraryPreferenceKey, mode, project, routines,
      activePathId: doc.id, activeRoutineId: routine.id, times,
      onMode: (next) => next === 'paths' ? setActive(activeIdx) : setActiveRoutine(routine.id),
      onPath: (id) => { const index = pathIndex(id); if (index >= 0) setActive(index); }, onRoutine: setActiveRoutine,
      controller: { ...pushController, requestPush: (scope) => { flushSync(() => finishEdit()); pushController.requestPush(scope); } },
      actions: { addPath, appendPath, addRoutine, duplicateRoutine, deleteRoutine, renameRoutine,
        duplicatePath: (id) => dupPath(pathIndex(id)), deletePath: (id) => delPath(pathIndex(id)), renamePath: (id, name) => renamePath(pathIndex(id), name),
        addFolder: addPathFolder, renameFolder: renamePathFolder, deleteFolder: deletePathFolder,
        movePath: (id, folderId) => movePathToFolder(pathIndex(id), folderId), linkPath: setPathLink },
    }, structure);

    const selNode = (page === 'auto' && routineSel) ? AUTO.findNode(routine, routineSel) : null;
    const fieldNotices = [
      exportError && { id: 'export', error: true, label: 'Export failed', detail: exportError,
        action: { label: 'Dismiss', onClick: () => setExportError('') } },
      planningNotice && !(optimizationOpen && normalError) && { id: 'planning', error: planningNotice.kind === 'interactive',
        label: planningNotice.kind === 'interactive' ? 'Trajectory unavailable' : 'Interactive preview',
        detail: planningNotice.message + (planningNotice.kind === 'interactive' ? ' Undo or adjust the geometry to try again.' : ''),
        action: !optimizationOpen ? { label: 'Optimize', onClick: () => setOptimizationOpen(true) } : undefined },
      !selectedPreview && !normalReady && !normal.error && { id: 'loading', label: 'Preparing trajectory…', detail: 'Preview timing is provisional until planning finishes.' },
      !optimizationOpen && currentOptimization && selectedReady && !accepted && { id: 'optimization', error: true, label: 'Optimization unavailable', detail: 'The saved optimization could not be validated. Review it before using this path.',
        action: { label: 'Optimize', onClick: () => setOptimizationOpen(true) } },
    ].filter(Boolean);


    if (!derivation.value) {
      if (derivation.error) throw derivation.error;
      return h('main', { className: 'fatal-error', role: 'status', 'aria-live': 'polite' },
        h('h1', null, 'Preparing path preview'),
        h('p', null, 'Calculating this path off the UI thread…'));
    }

    return h('div', { className: 'app' },
      h(Panels.Toolbar, { page, setPage: (next) => { finishEdit(); playbackStore.reset(); routinePlaybackStore.reset(); setPage(next); }, editorPage,
        alliance, setAlliance,
        onOpen: openProject, onSave: saveProject, onUndo: undo, onRedo: redo,
        optimizationOpen, toggleOptimization, optimizationApplied: Boolean(accepted) }),
      h(RobotPushDialog, { controller: pushController }),
      h(DiagnosticBundleDialog, { getProject: materializeProject, targetSelector: '.robot-connection-diagnostics', onOpen: pushController.close, renderKey: pushController.open + ':' + pushController.phase }),
      page === 'robot'
        ? h('main', { className: 'page-main' }, h(RobotPage, { robot, setRobot, unitSystem, setUnitSystem, pushController, mcpEnabled, agentProposal: agentProposal && agentProposal.operation === 'configureRobot' ? agentProposal : null, onApplyProposal: applyAgentProposal, onRejectProposal: rejectAgentProposal }))
        : page === 'auto'
        ? h('main', { className: 'stage stage-auto' },
            renderLibrary('routines', null),
            h(RoutineWorkspace, {
              routine,
              flow: h(RoutinePanelPlayback, { key: routine.id, embedded: true, collapsedIds: routineCollapsed[projectKey + ':' + routine.id] || [], onCollapsedIdsChange: (ids) => setRoutineCollapsed((current) => ({ ...current, [projectKey + ':' + routine.id]: ids })), store: routinePlaybackStore, routine, run, paths: project.paths, selId: routineSel, onSelect: setRoutineSel, acq, catalog: javaProjectState.catalog }),
              field: h(React.Fragment, null,
                h(RoutineFieldPlayback, { store: routinePlaybackStore, run, selectedId: routineSel, doc, derived, sel: { kind: null, idx: -1 }, tool: 'select', view, setView, alliance, showGrid, robot, drive: robot.drive, accent, metric, actions: autoFieldActions }),
                h(Panels.ViewControls, { zoomPct, zoomBy, onFit, showGrid, setShowGrid })),
              status: run.blocked && h('div', { className: 'routine-status ' + (run.planningStatus === 'error' ? 'error' : 'planning'), role: run.planningStatus === 'error' ? 'alert' : 'status' },
                h('span', { className: 'routine-status-icon' }, h(UI.Icon, { name: run.planningStatus === 'error' ? 'info' : 'route', size: 14 })),
                h('div', { className: 'routine-status-copy' },
                  h('b', null, run.planningStatus === 'error' ? 'Routine planning failed' : 'Planning routine trajectories…'),
                  run.planningError && h('span', null, run.planningError))),
              transport: h(RoutineTransportPlayback, { store: routinePlaybackStore, run }) }),
            h('aside', { className: 'rail rail-r' + (selNode ? '' : ' collapsed'), 'aria-label': 'Routine step inspector' },
              selNode && h(StepInspector, { node: selNode, paths: project.paths, acq, run, javaProject: { ...javaProjectState, link: linkJavaProject }, conditionOptions: AUTO.authoritativeConditions(javaProjectState.catalog) })))
        : h('main', { className: 'stage stage-plan' },
            renderLibrary('paths', (secOpen, setSecOpen) => h('div', { style: { height: '100%' }, inert: derivationCurrent ? undefined : '' }, h(Panels.Outline, { open: true, setOpen: () => {}, doc: derivationDoc, derived, sel, actions: inspActions, secOpen, setSecOpen, robot, ready: derivationCurrent }))),
            h('div', { className: 'fieldcol', inert: derivationCurrent ? undefined : '', 'aria-disabled': derivationCurrent ? undefined : true },
              h(Panels.ToolRail, { tool, setTool, brush, setBrush, waypointCount: derivationDoc.waypoints.length }),
              h(EditablePlaybackField, { store: playbackStore, editStore, doc, derived, derivedPath: derivation.path, robot, plannerId, optimizationCorridor: optimizationOpen && normalReady ? { points: normal.value?.sample.pts, widthM: doc.optimization?.corridorM ?? 0.15 } : null, insertionPreview: waypointPreview, proposalPreviews: agentProposal && agentProposal.status === 'ready' ? agentProposalPreview.previews : [], sel, tool, brush, view, setView, alliance, showGrid, drive: robot.drive, accent, metric, actions: fieldActions, showHandles: true }),
              h('div', { className: 'field-notices' },
              h(FieldStatus, { key: doc.id, notices: fieldNotices }),
              tool !== 'select' && !waypointPreview && h('div', { className: 'stage-hint', dangerouslySetInnerHTML: { __html: toolHint(tool) } }),
              waypointPreview && h('div', { className: 'insert-preview', role: 'region', 'aria-label': 'Preview waypoint insertion' },
                h('div', { className: 'insert-preview-copy' },
                  h('b', null, waypointPreview.pending ? 'Preparing waypoint preview' : waypointPreview.error ? 'Waypoint preview unavailable' : 'Preview waypoint'),
                  h('span', null, waypointPreview.error ? (waypointPreview.error.message || String(waypointPreview.error)) : waypointPreview.message)),
                h('div', { className: 'insert-preview-actions' },
                  h('button', { type: 'button', onClick: () => setWaypointPreviewRequest(null) }, 'Cancel'),
                  h('button', { className: 'primary', type: 'button', disabled: !waypointPreview.derived, onClick: applyWaypointPreview }, waypointPreview.actionLabel || 'Insert waypoint'))),
              agentProposal && h('div', { className: 'insert-preview agent-proposal', role: 'region', 'aria-label': 'Agent path proposal' },
                h('div', { className: 'insert-preview-copy' },
                  h('b', null, agentProposal.operation === 'replace' ? 'Agent repair proposal' : 'Agent path proposal'),
                  h('span', null, agentProposal.intent),
                  h('span', { className: 'agent-proposal-status' }, agentProposal.status === 'ready' ? 'Preview only — the project has not changed.' : agentProposal.status === 'stale' ? 'Stale — the project changed. Ask the agent to regenerate.' : agentProposal.status === 'applied' ? 'Applied as one undoable project change.' : 'Rejected.'),
                  agentProposal.status === 'ready' && h('div', { className: 'agent-candidates', role: 'radiogroup', 'aria-label': 'Agent proposal candidates' }, agentCandidates.map((candidate) => h('button', { key: candidate.id, type: 'button', role: 'radio', 'aria-checked': agentCandidate && candidate.id === agentCandidate.id, className: agentCandidate && candidate.id === agentCandidate.id ? 'selected' : '', onClick: () => setAgentCandidateId(candidate.id) }, candidate.label + (candidate.valid === false ? ' · invalid' : candidate.metrics ? ' · ' + candidate.metrics.totalTimeS.toFixed(2) + ' s' : '')))),
                  agentCandidate && agentCandidate.metrics && h('span', null, UnitPrefs.format(agentCandidate.metrics.totalDistanceM, 'm', 2) + ' · ' + UnitPrefs.format(agentCandidate.metrics.minimumClearanceM, 'm', 2) + ' modeled clearance'),
                  agentCandidate && agentCandidate.valid === false && agentCandidate.rejectionReason && h('span', { className: 'agent-proposal-status' }, 'Blocked: ' + agentCandidate.rejectionReason),
                  agentProposal.status === 'ready' && agentProposal.operation !== 'configureRobot' && agentProposalPreview.pending && h('span', { className: 'agent-proposal-status', role: 'status', 'aria-live': 'polite' }, 'Preparing the selected path preview…'),
                  agentProposal.status === 'ready' && agentProposal.operation !== 'configureRobot' && agentProposalPreview.error && h('span', { className: 'agent-proposal-status', role: 'alert' }, 'Selected path preview unavailable: ' + (agentProposalPreview.error.message || String(agentProposalPreview.error))),
                  agentProposal.recommendationReason && h('span', null, agentProposal.recommendationReason),
                  agentProposal.advisories && agentProposal.advisories.map((notice, index) => h('span', { key: 'advisory-' + index, className: 'agent-proposal-status' }, notice)),
                  agentProposal.blockingIssues && agentProposal.blockingIssues.map((issue, index) => h('span', { key: 'block-' + index, className: 'agent-proposal-status' }, 'Blocked: ' + issue))),
                h('div', { className: 'insert-preview-actions' },
                  agentProposal.status === 'ready' && h('button', { type: 'button', onClick: rejectAgentProposal }, 'Reject'),
                  agentProposal.status === 'ready' && h('button', { className: 'primary', type: 'button', disabled: !agentProposalCanApplyCandidate || (agentProposal.blockingIssues && agentProposal.blockingIssues.length > 0), onClick: applyAgentProposal }, agentProposal.operation === 'replace' ? 'Apply repair' : 'Add path'))),
              ),
              h(Panels.ConstraintBar, { c: derivationDoc.constraints, robot, onOpen: () => { setOptimizationOpen(false); setComparison(null); select(null, -1); } }),
              h(PlaybackTransport, { store: playbackStore, derived, doc: derivationDoc, metric, setMetric, graphOpen, setGraphOpen }),
              h(Panels.ViewControls, { zoomPct, zoomBy, onFit, showGrid, setShowGrid, graphOpen })),
            h('aside', { inert: derivationCurrent || (optimizationOpen && normalError) ? undefined : '', className: 'rail rail-r' + (inspectorOpen || optimizationOpen ? '' : ' collapsed'), 'aria-label': optimizationOpen ? 'Path optimization' : 'Path inspector' },
              optimizationOpen ? h(OptimizationPanel, {
                path: doc, paths: project.paths, state: optimizationState, candidate, accepted, stale: staleOptimization,
                baselineTime, pending: !normalReady && !normalError, error: normalError, mode: comparisonMode, unitSystem,
                recovery: !derivationCurrent ? (hist.current.past.length || routineHist.current.past.length || projectHist.current.past.length
                  ? { label: 'Undo last edit', onClick: undo }
                  : { label: 'Open project', onClick: openProject }) : undefined,
                onCorridor: setCorridor, onStart: startOptimization,
                onStartAll: () => { setComparison(null); void optimizer.startAll(); }, onCancel: optimizer.cancel,
                onCompare: compareTrajectory, onApply: applyOptimization, onNormal: useNormalTrajectory,
                onSelectPath: (id) => { const index = project.paths.findIndex((path) => path.id === id); if (index >= 0) setActive(index); },
                onClose: () => { compareTrajectory('selected'); setOptimizationOpen(false); setInspectorOpen(true); },
              }) : inspectorOpen
                ? h(ContextInspector, { project, setWaypointPositionLink, doc: derivationDoc, sel, derived, actions: inspActions, drive: robot.drive, robot, javaProject: { ...javaProjectState, link: linkJavaProject, openRecent: openRecentJavaProject, refresh: refreshJavaProject, install: installJavaSupport, build: buildJavaCatalog, cancelBuild: cancelJavaCatalogBuild, export: () => onExportJava('linked') }, onClose: () => setInspectorOpen(false) })
                : h('button', { className: 'inspector-tab', type: 'button', title: 'Show inspector', onClick: () => setInspectorOpen(true) }, h(UI.Icon, { name: 'sliders', size: 16 }), h('span', null, 'Inspector'))),
            headMenu && h(UI.ContextMenu, { x: headMenu.x, y: headMenu.y, items: headMenu.items, returnFocus: headMenu.returnFocus, onClose: () => setHeadMenu(null) })));
  }

  function toolHint(tool) {
    if (tool === 'waypoint') return 'Click the field to place the <b>next endpoint</b>';
    if (tool === 'rotation') return 'Click the path to set a <b>rotation target</b>';
    if (tool === 'marker') return 'Click the path to place an <b>event marker</b>';
    if (tool === 'range') return 'Drag along the path to define a <b>constraint range</b> \u00b7 then edit its limits';
    if (tool === 'brush') return 'Drag to <b>sculpt the path</b> \u00b7 [ and ] adjust the radius';
    return '';
  }

  class AppErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() {
      if (!this.state.error) return this.props.children;
      return h('main', { className: 'fatal-error', role: 'alert' },
        h('h1', null, 'Bordeaux could not render this project'),
        h('p', null, this.state.error.message || String(this.state.error)),
        h('button', { type: 'button', onClick: () => window.location.reload() }, 'Reload project'));
    }
  }

export { App, AppErrorBoundary, agentProposalMatchesPublishedContext, agentProposalPreviewResult, applyBrushDraft, canApplyAgentProposalCandidate, currentPathLength, duplicatePathForLibrary, pathPreviewResult, remapBrushSelection, requestRoutinePreview, requestWaypointPreview, routinePreviewResult, selectedAgentProposalPreview, syncBrushSelection, waypointPreviewResult };
