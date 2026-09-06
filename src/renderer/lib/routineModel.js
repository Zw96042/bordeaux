import { PM } from "./pathMath";
import { createRoutineNodeId } from "../../shared/project/ids";

// Autonomous Routine — autonomous routine model + run engine (no React).
// A routine is an ordered list of STEPS. Three step kinds: Path, Decision, Function.
// A Function carries a runtime capability or a generated Java command.
// Autonomous Routine is robot-agnostic: it ORCHESTRATES runtime generation, it does not define behaviors.
  // ---- runtime capabilities a Function can carry ----
  const CATS = {
    command:   { id: 'command',   label: 'Command',   icon: 'bolt',     color: '#4fbf78', blurb: 'Run a robot command between paths' },
    terminate: { id: 'terminate', label: 'Terminate', icon: 'stop',    color: '#d2655f', blurb: 'End the running path early and advance' },
    sequence:  { id: 'sequence',  label: 'Sequence',  icon: 'shuffle',  color: '#8a7bf0', blurb: 'Skip · repeat · jump · reorder paths' },
    generate:  { id: 'generate',  label: 'Generate',  icon: 'compass',  color: '#cf962f', blurb: 'Invoke a runtime path function' },
    velocity:  { id: 'velocity',  label: 'Velocity',  icon: 'gauge',    color: '#2bb3c4', blurb: 'Scale drive velocities live' },
  };
  const AUTHORABLE_STEPS = [
    { id: 'path', type: 'path', label: 'Path', description: 'Follow a planned trajectory', icon: 'route', color: 'var(--accent)' },
    { id: 'decision', type: 'decision', label: 'Decision', description: 'Branch the routine on a condition', icon: 'branch', color: '#9aa3b0' },
    { id: 'command', type: 'function', cat: 'command', label: 'Command', description: 'Run a generated robot command between paths', icon: 'bolt', color: '#4fbf78' },
    { id: 'wait', type: 'builtin', cat: 'wait', label: 'Wait', description: 'Pause the routine before its next step', icon: 'pause', color: '#cf962f' },
  ];

  function authoritativeConditions(catalog) {
    if (!catalog || catalog.authoritative !== true || !['1.1', '1.2', '1.3'].includes(catalog.generatedSchemaVersion)) return [];
    return (catalog.conditions || []).map((condition) => ({
      value: condition.id,
      label: condition.label,
      meta: condition.description || condition.id,
    }));
  }

  function conditionPickerItems(conditions, value, empty) {
    const registered = conditions || [];
    const out = [{ value: '', label: empty || 'Choose a registered condition', meta: 'No condition selected' }, ...registered];
    if (value && !registered.some((condition) => condition.value === value)) {
      out.splice(1, 0, { value, label: value, meta: 'Unavailable in the linked generated catalog; replace or remove it before export', badge: 'invalid' });
    }
    return out;
  }

  function hasWaitBuiltIn(catalog) {
    return Boolean(catalog && catalog.authoritative === true && (catalog.generatedSchemaVersion === '1.2' || catalog.generatedSchemaVersion === '1.3')
      && Array.isArray(catalog.builtIns)
      && catalog.builtIns.some((builtIn) => builtIn && builtIn.id === 'bordeaux.wait' && builtIn.kind === 'wait'));
  }

  function authorableSteps(catalog) {
    return AUTHORABLE_STEPS.filter((step) => step.id !== 'wait' || hasWaitBuiltIn(catalog));
  }

  function trajectoryGenerator(catalog, generatorId) {
    return catalog && catalog.authoritative === true && catalog.generatedSchemaVersion === '1.3'
      && Array.isArray(catalog.trajectoryGenerators)
      ? catalog.trajectoryGenerators.find((generator) => generator && generator.id === generatorId)
      : null;
  }

  function nodeDeploymentState(node, catalog) {
    if (!node || typeof node !== 'object') return { deployable: false, legacy: false, label: 'Unknown step' };
    if (node.type === 'path' || node.type === 'decision') return { deployable: true, legacy: false };
    if (node.type === 'builtin' && node.builtinId === 'bordeaux.wait') return { deployable: true, legacy: false };
    if (node.type === 'generatedTrajectory') {
      const generator = trajectoryGenerator(catalog, node.generatorId);
      return { deployable: Boolean(generator), legacy: false, dynamic: true, label: generator ? generator.label : 'Runtime dynamic trajectory' };
    }
    if (node.type === 'function' && node.cat === 'command') return { deployable: true, legacy: false };
    if (node.type === 'function' && CATS[node.cat]) return { deployable: false, legacy: true, label: CATS[node.cat].label };
    return { deployable: false, legacy: false, label: 'Unknown step' };
  }

  // ---- Sequence is a CORE Autonomous Routine feature: orchestration ops, robot-independent ----
  const SEQ_OPS = [
    { id: 'skip',    label: 'Skip path',         verb: 'Skip',        blurb: 'Skip the next path in the routine' },
    { id: 'repeat',  label: 'Repeat path',       verb: 'Repeat',      blurb: 'Run a path again before continuing' },
    { id: 'jump',    label: 'Jump to path',      verb: 'Jump to',     blurb: 'Continue the routine from another path' },
    { id: 'reorder', label: 'Reorder remaining', verb: 'Reorder',     blurb: 'Re-sequence the paths still ahead' },
    { id: 'insert',  label: 'Insert path',       verb: 'Insert',      blurb: 'Splice a path into the live sequence' },
    { id: 'remove',  label: 'Remove path',       verb: 'Remove',      blurb: 'Drop an upcoming path from the sequence' },
  ];
  const seqOp = (id) => SEQ_OPS.find((o) => o.id === id) || SEQ_OPS[0];

  // ---- display title for any node ----
  function nodeTitle(node, paths, catalog) {
    if (!node || typeof node !== 'object') return 'Unknown step';
    if (node.type === 'path') { const p = paths && paths.find((path) => path.id === node.ref); return p ? p.name : '(unbound path)'; }
    if (node.type === 'decision') return node.cond || 'Choose condition';
    if (node.type === 'builtin') return node.builtinId === 'bordeaux.wait' ? 'Wait' : 'Unsupported built-in';
    if (node.type === 'generatedTrajectory') {
      const generator = trajectoryGenerator(catalog, node.generatorId);
      return `${generator ? generator.label : (node.generatorId || 'Generated trajectory')} · Runtime dynamic`;
    }
    if (node.cat === 'command') return node.title || (node.invocation && node.invocation.commandId) || 'Choose command';
    if (node.cat === 'generate') return node.funcRef || 'GeneratePath';
    if (node.cat === 'sequence') { const o = seqOp(node.op); return o.verb + (node.target ? ' · ' + node.target : ''); }
    return node.title || (CATS[node.cat] && CATS[node.cat].label) || 'Unknown step';
  }

  // ---- node factory ----
  function newNode(type, cat, pathRef) {
    const id = createRoutineNodeId();
    if (type === 'path') return { id, type: 'path', ref: pathRef || '' };
    if (type === 'decision') return { id, type: 'decision', cond: '', thenLabel: 'Yes', elseLabel: 'No', then: [], else: [] };
    if (type === 'builtin' && cat === 'wait') return { id, type: 'builtin', builtinId: 'bordeaux.wait', arguments: { durationS: 1 } };
    const c = cat || 'terminate';
    if (c === 'command') return { id, type: 'function', cat: 'command', title: 'Robot command', invocation: null };
    if (c === 'generate') return { id, type: 'function', cat: 'generate', funcRef: 'GeneratePath', trigger: 'On entry', params: [], note: '', preview: null };
    if (c === 'sequence') return { id, type: 'function', cat: 'sequence', op: 'skip', target: '', trigger: 'When condition is true', note: '' };
    if (c === 'velocity') return { id, type: 'function', cat: 'velocity', title: 'Velocity rule', trigger: 'When condition is true', scale: 0.5, note: '' };
    return { id, type: 'function', cat: 'terminate', title: 'Terminate', trigger: 'When condition is true', note: '' };
  }

  // ---- walk every node (incl. branch children) ----
  function walk(nodes, fn, depth, branch) {
    (Array.isArray(nodes) ? nodes : []).forEach((n) => {
      fn(n, depth || 0, branch || null);
      if (n.type === 'decision') { walk(n.then, fn, (depth || 0) + 1, 'then'); walk(n.else, fn, (depth || 0) + 1, 'else'); }
    });
  }
  function findNode(routine, id) { let hit = null; walk(routine.nodes, (n) => { if (n.id === id) hit = n; }); return hit; }
  function countSteps(routine) { let n = 0; walk(routine.nodes, () => n++); return n; }

  // ---- derive a path-bearing node into a field trajectory ----
  function derivePathNode(node, pathsById, robot, plannerId, plannedPaths, derivedPaths, derivePath = PM.derivePath) {
    let doc = null;
    if (node.type === 'path') doc = pathsById.get(node.ref);
    else if (node.type === 'function' && node.cat === 'generate' && node.preview) doc = node.preview;
    if (!doc) return null;
    if (derivedPaths.has(doc)) return derivedPaths.get(doc);
    const planned = plannedPaths && plannedPaths[doc.id];
    if (plannedPaths && !planned) return null;
    const d = planned || derivePath(doc, robot, 56, plannerId);
    const trajectory = d.finalTrajectory || null;
    const result = {
      doc,
      deriv: d,
      trajectory,
      pts: trajectory ? trajectory.samples : d.sample.pts,
      total: trajectory ? trajectory.totalTimeS : d.prof.totalTime || 0,
    };
    derivedPaths.set(doc, result);
    return result;
  }

  function trajectoryPoseAt(trajectory, time) {
    const samples = trajectory && trajectory.samples;
    if (!samples || !samples.length) return null;
    if (samples.length === 1 || time <= samples[0].t) {
      const sample = samples[0];
      return { x: sample.x, y: sample.y, heading: sample.headingRad, speed: sample.velocityMps, s: sample.s, f: sample.f };
    }
    if (time >= samples[samples.length - 1].t) {
      const sample = samples[samples.length - 1];
      return { x: sample.x, y: sample.y, heading: sample.headingRad, speed: sample.velocityMps, s: sample.s, f: sample.f };
    }
    let low = 1, high = samples.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (samples[middle].t < time) low = middle + 1;
      else high = middle;
    }
    const after = samples[low], before = samples[low - 1];
    const ratio = Math.max(0, Math.min(1, (time - before.t) / Math.max(1e-9, after.t - before.t)));
    const headingDelta = Math.atan2(
      Math.sin(after.headingRad - before.headingRad),
      Math.cos(after.headingRad - before.headingRad),
    );
    const lerp = (first, second) => first + (second - first) * ratio;
    return {
      x: lerp(before.x, after.x),
      y: lerp(before.y, after.y),
      heading: before.headingRad + headingDelta * ratio,
      speed: lerp(before.velocityMps, after.velocityMps),
      s: lerp(before.s, after.s),
      f: lerp(before.f, after.f),
    };
  }

  const EVENT_DWELL = 0.45; // seconds a non-driving function holds for, in the run

  // ---- flatten a routine into an executed step list given decision outcomes ----
  function buildRun(routine, paths, robot, outcomes, plannerId, catalog, plannedPaths) {
    const derivePath = typeof catalog === 'function' ? catalog : PM.derivePath;
    if (typeof catalog === 'function') catalog = null;
    if (plannedPaths?.status && plannedPaths.status !== 'ready') {
      return {
        steps: [], segs: [], total: 0, blocked: true,
        planningStatus: plannedPaths.status,
        planningError: plannedPaths.error || '',
      };
    }
    const plannedValues = plannedPaths?.values || plannedPaths;
    const pathsById = new Map();
    for (const path of paths) if (!pathsById.has(path.id)) pathsById.set(path.id, path);
    // Repeated routine steps share geometry within this build. Keep the cache
    // local so path, robot, or authoritative-plan changes cannot go stale.
    const derivedPaths = new Map();
    outcomes = outcomes || {};
    const flat = [];
    const collect = (nodes) => {
      (nodes || []).forEach((n) => {
        if (n.type === 'decision') {
          flat.push({ node: n, kind: 'decision' });
          const out = outcomes[n.id] || 'then';
          collect(out === 'else' ? n.else : n.then);
        } else if (n.type === 'path') {
          flat.push({ node: n, kind: 'path' });
        } else if (n.type === 'builtin') {
          flat.push({ node: n, kind: 'wait' });
        } else if (n.type === 'generatedTrajectory') {
          flat.push({ node: n, kind: 'dynamic', label: nodeTitle(n, paths, catalog) });
        } else if (n.cat === 'generate' && n.preview) {
          flat.push({ node: n, kind: 'gen' });
        } else {
          flat.push({ node: n, kind: 'event' });
        }
      });
    };
    collect(routine.nodes);

    let t = 0, pIdx = 0; const steps = []; const segs = []; let lastPose = null;
    flat.forEach((it) => {
      if (it.kind === 'path' || it.kind === 'gen') {
        const dp = derivePathNode(it.node, pathsById, robot, plannerId, plannedValues, derivedPaths, derivePath);
        if (!dp || dp.pts.length < 2) { steps.push({ ...it, t0: t, t1: t, dur: 0 }); return; }
        const t0 = t, dur = dp.total, t1 = t + dur;
        pIdx += 1;
        const idxLabel = String(pIdx).padStart(2, '0');
        const label = it.node.type === 'path' ? dp.doc.name : (it.node.funcRef || 'Generated');
        segs.push({ nodeId: it.node.id, kind: it.kind, label, idxLabel, pts: dp.pts, t0, t1, deriv: dp.deriv, trajectory: dp.trajectory, doc: dp.doc });
        steps.push({ ...it, t0, t1, dur, segIdx: segs.length - 1, idxLabel, label, dist: dp.trajectory ? dp.trajectory.totalDistanceM : dp.deriv.sample.length });
        lastPose = dp.trajectory
          ? trajectoryPoseAt(dp.trajectory, dp.total)
          : PM.poseAtTime(dp.total, dp.pts, dp.deriv.prof, dp.deriv.anchors, dp.deriv.mode, dp.deriv.rev);
        t = t1;
      } else if (it.kind === 'dynamic') {
        steps.push({ ...it, t0: t, t1: t, dur: 0, dynamic: true, pose: lastPose });
      } else if (it.kind === 'wait') {
        const dur = Math.max(0, Number.isFinite(it.node.arguments && it.node.arguments.durationS) ? it.node.arguments.durationS : 0);
        steps.push({ ...it, t0: t, t1: t + dur, dur, pose: lastPose });
        t += dur;
      } else if (it.kind === 'event') {
        steps.push({ ...it, t0: t, t1: t + EVENT_DWELL, dur: EVENT_DWELL, pose: lastPose });
        t += EVENT_DWELL;
      } else { // decision — instant
        steps.push({ ...it, t0: t, t1: t, dur: 0 });
      }
    });
    return { steps, segs, total: t };
  }

  // ---- pose along the run at time ----
  function poseAt(run, time, robot) {
    if (!run.steps.length) return null;
    const cur = run.steps[stepIndexAt(run.steps, time, true)];
    if (cur.segIdx != null) {
      const seg = run.segs[cur.segIdx];
      return seg.trajectory
        ? trajectoryPoseAt(seg.trajectory, time - cur.t0)
        : PM.poseAtTime(time - cur.t0, seg.pts, seg.deriv.prof, seg.deriv.anchors, seg.deriv.mode, seg.deriv.rev);
    }
    if (cur.pose) return { x: cur.pose.x, y: cur.pose.y, heading: cur.pose.heading || 0, speed: 0 };
    return null;
  }

  // Steps are emitted in time order, including zero-duration decisions. Find
  // the first matching end so boundary ties retain the previous step's pose.
  function stepIndexAt(steps, time, inclusive) {
    let low = 0, high = steps.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const end = steps[middle].t1 + 1e-6;
      if (inclusive ? time <= end : time < end) high = middle;
      else low = middle + 1;
    }
    return low < steps.length && time >= steps[low].t0 ? low : steps.length - 1;
  }

  // ---- which step is current at a time (for highlighting) ----
  function stepAt(run, time) {
    return stepIndexAt(run.steps, time, false);
  }

  // ---- field overlay descriptor for FieldView ----
  function fieldOverlay(run, opts) {
    opts = opts || {};
    const { time, running, selectedId } = opts;
    const selHasSeg = !running && selectedId != null && run.segs.some((s) => s.nodeId === selectedId);
    return run.segs.map((seg) => {
      let state;
      if (running && time != null) {
        state = time >= seg.t1 ? 'done' : (time >= seg.t0 ? 'active' : 'pending');
        if (seg.kind === 'gen' && state !== 'pending') state = 'generated';
      } else if (selHasSeg) {
        if (seg.nodeId === selectedId) state = seg.kind === 'gen' ? 'genfocus' : 'focus';
        else state = 'dim';
      } else {
        state = seg.kind === 'gen' ? 'generated' : 'done';
      }
      return { nodeId: seg.nodeId, label: seg.label, idxLabel: seg.idxLabel, pts: seg.pts, kind: seg.kind, state };
    });
  }

export const AUTO = { CATS, AUTHORABLE_STEPS, authoritativeConditions, conditionPickerItems, hasWaitBuiltIn, authorableSteps, nodeDeploymentState, nodeTitle, newNode, walk, findNode, countSteps, branchCount,
    buildRun, poseAt, stepAt, fieldOverlay,
    update, remove, insertAfter, prepend, appendBranch, append, move, siblingNodes, canReorderRelative, reorderRelative };

  // ---- immutable-ish routine edits (operate on a deep clone) ----
  function _clone(o) { return JSON.parse(JSON.stringify(o)); }
  function update(routine, id, patch) { const r = _clone(routine); walk(r.nodes, (n) => { if (n.id === id) Object.assign(n, patch); }); return r; }
  function remove(routine, id) {
    const r = _clone(routine);
    const rm = (arr) => { const i = arr.findIndex((n) => n.id === id); if (i >= 0) { arr.splice(i, 1); return true; } for (const n of arr) { if (n.type === 'decision' && (rm(n.then) || rm(n.else))) return true; } return false; };
    rm(r.nodes); return r;
  }
  function insertAfter(routine, id, node) {
    const r = _clone(routine);
    const ins = (arr) => { const i = arr.findIndex((n) => n.id === id); if (i >= 0) { arr.splice(i + 1, 0, node); return true; } for (const n of arr) { if (n.type === 'decision' && (ins(n.then) || ins(n.else))) return true; } return false; };
    if (!ins(r.nodes)) r.nodes.push(node); return r;
  }
  function prepend(routine, node) { const r = _clone(routine); r.nodes.unshift(node); return r; }
  function appendBranch(routine, decId, branch, node) { const r = _clone(routine); walk(r.nodes, (n) => { if (n.id === decId) { n[branch] = n[branch] || []; n[branch].push(node); } }); return r; }
  function append(routine, node) { const r = _clone(routine); r.nodes.push(node); return r; }
  // move a node up/down within its own containing array
  function move(routine, id, dir) {
    const r = _clone(routine);
    const mv = (arr) => {
      const i = arr.findIndex((n) => n.id === id);
      if (i >= 0) { const j = i + dir; if (j < 0 || j >= arr.length) return true; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; return true; }
      for (const n of arr) { if (n.type === 'decision' && (mv(n.then) || mv(n.else))) return true; }
      return false;
    };
    mv(r.nodes); return r;
  }
  function siblingNodes(routine, id) {
    const find = (nodes) => {
      if (nodes.some((node) => node.id === id)) return nodes;
      for (const node of nodes) {
        if (node.type !== 'decision') continue;
        const siblings = find(node.then || []) || find(node.else || []);
        if (siblings) return siblings;
      }
      return null;
    };
    return find(routine.nodes);
  }
  function canReorderRelative(routine, id, targetId, before) {
    const siblings = siblingNodes(routine, id);
    if (!siblings || id === targetId) return false;
    const source = siblings.findIndex((node) => node.id === id);
    const target = siblings.findIndex((node) => node.id === targetId);
    if (target < 0) return false;
    return before ? source !== target - 1 : source !== target + 1;
  }
  // Feedback and mutation share the same sibling-only, non-no-op rule.
  function reorderRelative(routine, id, targetId, before) {
    if (!canReorderRelative(routine, id, targetId, before)) return routine;
    const r = _clone(routine);
    const siblings = siblingNodes(r, id);
    const [node] = siblings.splice(siblings.findIndex((item) => item.id === id), 1);
    const target = siblings.findIndex((item) => item.id === targetId);
    siblings.splice(before ? target : target + 1, 0, node);
    return r;
  }
  // total step count inside a branch (recursive)
  function branchCount(nodes) { let c = 0; walk(nodes || [], () => c++); return c; }
