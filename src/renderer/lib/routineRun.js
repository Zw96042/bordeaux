const EVENT_DWELL = 0.45;

function derivePathNode(node, pathsById, robot, plannerId, cache, derivePath) {
  let doc = null;
  if (node.type === 'path') doc = pathsById.get(node.ref);
  else if (node.type === 'function' && node.cat === 'generate' && node.preview) doc = node.preview;
  if (!doc) return null;
  if (cache.has(doc)) return cache.get(doc);
  const deriv = derivePath(doc, robot, 56, plannerId);
  const playback = deriv.playback;
  const result = {
    doc,
    deriv,
    pts: playback ? playback.pts : deriv.sample.pts,
    total: (playback ? playback.prof : deriv.prof).totalTime || 0,
  };
  cache.set(doc, result);
  return result;
}

/** Builds a routine run without importing either renderer or shared path math. */
export function buildRoutineRun(routine, paths, robot, outcomes, plannerId, derivePath) {
  outcomes = outcomes || {};
  const flat = [];
  const collect = (nodes) => {
    (nodes || []).forEach((node) => {
      if (node.type === 'decision') {
        flat.push({ node, kind: 'decision' });
        collect((outcomes[node.id] || 'then') === 'else' ? node.else : node.then);
      } else if (node.type === 'path') flat.push({ node, kind: 'path' });
      else if (node.cat === 'generate' && node.preview) flat.push({ node, kind: 'gen' });
      else flat.push({ node, kind: 'event' });
    });
  };
  collect(routine.nodes);

  let time = 0, pathIndex = 0, lastPose = null;
  const steps = [], segs = [];
  const pathsById = new Map((paths || []).map((path) => [path.id, path]));
  const derivedPaths = new Map();
  flat.forEach((item) => {
    if (item.kind === 'path' || item.kind === 'gen') {
      const path = derivePathNode(item.node, pathsById, robot, plannerId, derivedPaths, derivePath);
      if (!path || path.pts.length < 2) { steps.push({ ...item, t0: time, t1: time, dur: 0 }); return; }
      const t0 = time, dur = path.total, t1 = time + dur;
      pathIndex += 1;
      const idxLabel = String(pathIndex).padStart(2, '0');
      const label = item.node.type === 'path' ? path.doc.name : (item.node.funcRef || 'Generated');
      segs.push({ nodeId: item.node.id, kind: item.kind, label, idxLabel, pts: path.pts, t0, t1, deriv: path.deriv, doc: path.doc });
      steps.push({ ...item, t0, t1, dur, segIdx: segs.length - 1, idxLabel, label, dist: path.deriv.sample.length });
      lastPose = path.pts[path.pts.length - 1];
      time = t1;
    } else if (item.kind === 'event') {
      steps.push({ ...item, t0: time, t1: time + EVENT_DWELL, dur: EVENT_DWELL, pose: lastPose });
      time += EVENT_DWELL;
    } else steps.push({ ...item, t0: time, t1: time, dur: 0 });
  });
  return { steps, segs, total: time };
}
