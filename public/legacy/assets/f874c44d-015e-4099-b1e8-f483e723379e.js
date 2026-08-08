// Autonomous Routine — autonomous routine model + run engine (no React). Exports window.AUTO
// A routine is an ordered list of STEPS. Three step kinds: Path, Decision, Function.
// A Function carries a runtime capability or a generated Java command.
// Autonomous Routine is robot-agnostic: it ORCHESTRATES runtime generation, it does not define behaviors.
(function () {
  const D2R = Math.PI / 180;
  let _id = 0;
  const uid = (p) => (p || 'n') + '_' + (++_id);

  // ---- runtime capabilities a Function can carry ----
  const CATS = {
    command:   { id: 'command',   label: 'Command',   icon: 'bolt',     color: '#4fbf78', blurb: 'Run a robot command between paths' },
    terminate: { id: 'terminate', label: 'Terminate', icon: 'stop',    color: '#d2655f', blurb: 'End the running path early and advance' },
    sequence:  { id: 'sequence',  label: 'Sequence',  icon: 'shuffle',  color: '#8a7bf0', blurb: 'Skip · repeat · jump · reorder paths' },
    generate:  { id: 'generate',  label: 'Generate',  icon: 'compass',  color: '#cf962f', blurb: 'Invoke a runtime path function' },
    velocity:  { id: 'velocity',  label: 'Velocity',  icon: 'gauge',    color: '#2bb3c4', blurb: 'Scale drive velocities live' },
  };
  const CAT_LIST = ['command', 'terminate', 'sequence', 'generate', 'velocity'];

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
  function nodeTitle(node, paths) {
    if (node.type === 'path') { const p = paths && paths.find((path) => path.id === node.ref); return p ? p.name : '(unbound path)'; }
    if (node.type === 'decision') return node.cond;
    if (node.cat === 'command') return node.title || (node.invocation && node.invocation.commandId) || 'Choose command';
    if (node.cat === 'generate') return node.funcRef || 'GeneratePath';
    if (node.cat === 'sequence') { const o = seqOp(node.op); return o.verb + (node.target ? ' · ' + node.target : ''); }
    return node.title || CATS[node.cat].label;
  }

  // ---- build smooth handles for a preview trajectory ----
  function buildWps(raw) {
    const out = raw.map((w) => ({ linked: true, thetaOn: false, theta: 0, stop: false, ...w }));
    out.forEach((w, i) => { const hd = window.PM.autoHandles(out, i); if (!w.prevC) w.prevC = hd.prevC; if (!w.nextC) w.nextC = hd.nextC; });
    if (out.length) { out[0].thetaOn = true; out[out.length - 1].thetaOn = true; }
    return out;
  }
  function genPath(name, raw) {
    return { name, waypoints: buildWps(raw), targets: [], markers: [], ranges: [],
      constraints: { maxVel: 2.6, maxAccel: 4.5, maxDecel: 4.5, maxAngVel: 420, maxAngAccel: 640 }, startVel: 0, goalVel: 0 };
  }

  // ---- demo routine: a blue-side Reefscape qualification auto ----
  // Generate steps reference robot-code functions (funcRef); the dashed preview is sim-only.
  function demoRoutine(paths) {
    _id = 0;
    paths = paths || [];
    return {
      name: 'Qual_Auto_A',
      nodes: [
        { id: uid('p'), type: 'path', ref: paths[0] ? paths[0].id : '' },
        { id: uid('f'), type: 'function', cat: 'terminate', title: 'Coral scored', trigger: 'Vision confirms L4 placement', note: 'Cuts the scoring dwell the instant the coral clears the gripper instead of waiting out a fixed timer.' },
        {
          id: uid('d'), type: 'decision', cond: 'Coral remaining \u2265 1', metric: 'gamePieces',
          thenLabel: 'detected', elseLabel: 'none / timeout',
          then: [
            { id: uid('g'), type: 'function', cat: 'generate', funcRef: 'GenerateNearestCoral', trigger: 'On branch entry',
              params: [{ k: 'maxRange', v: '3.0 m' }, { k: 'piece', v: 'coral' }],
              note: 'Robot code returns a trajectory to whatever coral it judges best. Autonomous Routine just invokes it.',
              preview: genPath('preview_coral', [{ x: 4.10, y: 5.05, theta: 60 }, { x: 3.45, y: 4.05 }, { x: 2.95, y: 3.25, theta: -60 }]) },
            { id: uid('v'), type: 'function', cat: 'velocity', title: 'Precision intake', trigger: 'Within 0.8 m of target', scale: 0.35, note: 'Drops translational speed so the intake seats the coral without punching it out.' },
          ],
          else: [
            { id: uid('s'), type: 'function', cat: 'sequence', op: 'skip', target: 'Reef_Station', trigger: 'No target in view', note: 'Abandons the opportunistic pickup and proceeds straight to the next scored path.' },
          ],
        },
        { id: uid('p'), type: 'path', ref: paths[1] ? paths[1].id : '' },
        { id: uid('p'), type: 'path', ref: paths[2] ? paths[2].id : '' },
        { id: uid('g'), type: 'function', cat: 'generate', funcRef: 'GenerateParkingPath', trigger: 'Routine end',
          params: [{ k: 'zone', v: 'alliance' }],
          note: 'Robot code plans a clean exit to the park zone from wherever the robot finishes.',
          preview: genPath('preview_park', [{ x: 3.85, y: 4.95, theta: -120 }, { x: 2.65, y: 3.10 }, { x: 1.60, y: 1.45, theta: -135 }]) },
      ],
    };
  }

  // ---- node factory ----
  function newNode(type, cat, pathRef) {
    if (type === 'path') return { id: uid('p'), type: 'path', ref: pathRef || '' };
    if (type === 'decision') return { id: uid('d'), type: 'decision', cond: 'robot.condition', thenLabel: 'Yes', elseLabel: 'No', then: [], else: [] };
    const c = cat || 'terminate';
    if (c === 'command') return { id: uid('c'), type: 'function', cat: 'command', title: 'Robot command', invocation: null };
    if (c === 'generate') return { id: uid('g'), type: 'function', cat: 'generate', funcRef: 'GeneratePath', trigger: 'On entry', params: [], note: '', preview: null };
    if (c === 'sequence') return { id: uid('s'), type: 'function', cat: 'sequence', op: 'skip', target: '', trigger: 'When\u2026', note: '' };
    if (c === 'velocity') return { id: uid('v'), type: 'function', cat: 'velocity', title: 'Velocity rule', trigger: 'When\u2026', scale: 0.5, note: '' };
    return { id: uid('f'), type: 'function', cat: 'terminate', title: 'Terminate', trigger: 'When\u2026', note: '' };
  }

  // ---- walk every node (incl. branch children) ----
  function walk(nodes, fn, depth, branch) {
    (nodes || []).forEach((n) => {
      fn(n, depth || 0, branch || null);
      if (n.type === 'decision') { walk(n.then, fn, (depth || 0) + 1, 'then'); walk(n.else, fn, (depth || 0) + 1, 'else'); }
    });
  }
  function findNode(routine, id) { let hit = null; walk(routine.nodes, (n) => { if (n.id === id) hit = n; }); return hit; }
  function countSteps(routine) { let n = 0; walk(routine.nodes, () => n++); return n; }

  // ---- derive a path-bearing node into a field trajectory ----
  function derivePathNode(node, paths, robot, plannerId) {
    let doc = null;
    if (node.type === 'path') doc = paths.find((path) => path.id === node.ref);
    else if (node.type === 'function' && node.cat === 'generate' && node.preview) doc = node.preview;
    if (!doc) return null;
    const d = window.PM.derivePath(doc, robot, 56, plannerId);
    return { doc, deriv: d, pts: d.sample.pts, total: d.prof.totalTime || 0 };
  }

  const EVENT_DWELL = 0.45; // seconds a non-driving function holds for, in the run

  // ---- flatten a routine into an executed step list given decision outcomes ----
  function buildRun(routine, paths, robot, outcomes, plannerId) {
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
        const dp = derivePathNode(it.node, paths, robot, plannerId);
        if (!dp || dp.pts.length < 2) { steps.push({ ...it, t0: t, t1: t, dur: 0 }); return; }
        const t0 = t, dur = dp.total, t1 = t + dur;
        pIdx += 1;
        const idxLabel = String(pIdx).padStart(2, '0');
        const label = it.node.type === 'path' ? dp.doc.name : (it.node.funcRef || 'Generated');
        segs.push({ nodeId: it.node.id, kind: it.kind, label, idxLabel, pts: dp.pts, t0, t1, deriv: dp.deriv, doc: dp.doc });
        steps.push({ ...it, t0, t1, dur, segIdx: segs.length - 1, idxLabel, label, dist: dp.deriv.sample.length });
        lastPose = dp.pts[dp.pts.length - 1];
        t = t1;
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
    const mode = (robot && robot.drive === 'tank') ? 'tank' : 'swerve';
    let cur = null;
    for (const s of run.steps) { if (time >= s.t0 && time <= s.t1 + 1e-6) { cur = s; break; } cur = s; }
    if (!cur) cur = run.steps[run.steps.length - 1];
    if (cur.segIdx != null) {
      const seg = run.segs[cur.segIdx];
      return window.PM.poseAtTime(time - cur.t0, seg.pts, seg.deriv.prof, seg.deriv.anchors, mode);
    }
    if (cur.pose) return { x: cur.pose.x, y: cur.pose.y, heading: cur.pose.heading || 0, speed: 0 };
    return null;
  }

  // ---- which step is current at a time (for highlighting) ----
  function stepAt(run, time) {
    for (let i = 0; i < run.steps.length; i++) { const s = run.steps[i]; if (time >= s.t0 && time < s.t1 + 1e-6) return i; }
    return run.steps.length - 1;
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

  window.AUTO = { CATS, CAT_LIST, SEQ_OPS, seqOp, nodeTitle, demoRoutine, newNode, walk, findNode, countSteps, branchCount,
    buildRun, poseAt, stepAt, fieldOverlay, genPath, D2R,
    update, remove, insertAfter, prepend, appendBranch, prependBranch, append, move, reorderRelative };

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
  function prependBranch(routine, decId, branch, node) { const r = _clone(routine); walk(r.nodes, (n) => { if (n.id === decId) { n[branch] = n[branch] || []; n[branch].unshift(node); } }); return r; }
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
  // drag-reorder: move `id` to sit immediately before/after `targetId` within the SAME sibling array
  function reorderRelative(routine, id, targetId, before) {
    if (id === targetId) return routine;
    const r = _clone(routine);
    const run = (arr) => {
      const si = arr.findIndex((n) => n.id === id);
      const ti = arr.findIndex((n) => n.id === targetId);
      if (si >= 0 && ti >= 0) {
        const [node] = arr.splice(si, 1);
        const idx = arr.findIndex((n) => n.id === targetId);
        arr.splice(before ? idx : idx + 1, 0, node);
        return true;
      }
      if (si >= 0 || ti >= 0) return true; // both must share an array; bail otherwise
      for (const n of arr) { if (n.type === 'decision' && (run(n.then) || run(n.else))) return true; }
      return false;
    };
    run(r.nodes); return r;
  }
  // total step count inside a branch (recursive)
  function branchCount(nodes) { let c = 0; walk(nodes || [], () => c++); return c; }
})();
