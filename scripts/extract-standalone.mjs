import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const source = path.join(root, "Bordeaux (standalone).html");
const html = fs.readFileSync(source, "utf8");
const manifestMatch = html.match(
  /<script type="__bundler\/manifest">([\s\S]*?)<\/script>/,
);

if (!manifestMatch) {
  throw new Error("Could not find standalone bundle manifest");
}

const manifest = JSON.parse(manifestMatch[1]);
const templateMatch = html.match(
  /<script type="__bundler\/template">([\s\S]*?)<\/script>/,
);

if (!templateMatch) {
  throw new Error("Could not find standalone bundle template");
}

const template = JSON.parse(templateMatch[1]);

function bytesFor(entry) {
  const raw = Buffer.from(entry.data, "base64");
  return entry.compressed ? zlib.gunzipSync(raw) : raw;
}

function writeGeneratedPm(id, text) {
  const output = transformMathJs(text)
    .replace(
      /^\/\/ Bordeaux — path math engine \(no React\)\. Exports to window\.PM\n\(function \(\) \{\n/,
      "// @ts-nocheck\n// Generated from Bordeaux (standalone).html. Do not edit by hand.\n",
    )
    .replace(
      /\n\s*window\.PM = \{([\s\S]*?)\};\n\}\)\(\);\s*$/,
      "\nexport const PM = {$1};\nexport default PM;\n",
    );

  if (!output.includes("export const PM")) {
    throw new Error(`Failed to transform PM bundle ${id}`);
  }

  fs.writeFileSync(path.join(root, "src/shared/math/pm.ts"), output);
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Could not patch ${label}`);
  }
  return text.replace(search, replacement);
}

function transformMathJs(text) {
  if (!text.startsWith("// Bordeaux — path math engine")) return text;

  const start = text.indexOf("  function sample(waypoints, perSeg = 60) {");
  const end = text.indexOf("\n\n  // ---- trapezoidal velocity profile", start);
  if (start < 0 || end < 0) {
    throw new Error("Could not find PM sample() for clothoid blend patch");
  }

  const replacement = `  function sample(waypoints, perSeg = 60) {
    const pts = [];
    const segs = waypoints.length - 1;
    if (segs < 1) return { pts: [], length: 0, segs: 0 };
    const steps = perSeg;

    const segTypeAt = (i) => (waypoints[i] && waypoints[i].segType) || 'bezier';
    const pointOf = (w) => ({ x: w.x, y: w.y });
    const chordHeading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    const outHeading = (i) => {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = pointOf(w0), p1 = pointOf(w1), c0 = w0.nextC || p1;
      return Math.hypot(c0.x - p0.x, c0.y - p0.y) > 1e-6 ? Math.atan2(c0.y - p0.y, c0.x - p0.x) : chordHeading(p0, p1);
    };
    const inHeading = (i) => {
      const w0 = waypoints[i - 1], w1 = waypoints[i];
      const p0 = pointOf(w0), p1 = pointOf(w1), c1 = w1.prevC || p0;
      return Math.hypot(p1.x - c1.x, p1.y - c1.y) > 1e-6 ? Math.atan2(p1.y - c1.y, p1.x - c1.x) : chordHeading(p0, p1);
    };
    const blendedJointHeading = (i) => {
      const prevIsClothoid = i > 0 && segTypeAt(i - 1) === 'clothoid';
      const nextIsClothoid = i < segs && segTypeAt(i) === 'clothoid';
      if (prevIsClothoid && nextIsClothoid) {
        const a = inHeading(i), b = outHeading(i);
        return a + 0.5 * angWrap(b - a);
      }
      if (prevIsClothoid) return inHeading(i);
      if (nextIsClothoid) return outHeading(i);
      return 0;
    };
    const jointHeading = waypoints.map((_, i) => blendedJointHeading(i));
    const clothoidSegments = new Set();

    for (let i = 0; i < segs; i++) {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = { x: w0.x, y: w0.y }, p1 = { x: w1.x, y: w1.y };
      const c0 = w0.nextC, c1 = w1.prevC;
      let type = w0.segType || 'bezier';
      let arc = null, cloth = null, effType = type;
      if (type === 'arc') { arc = arcSetup(p0, p1, c0); if (!arc) effType = 'line'; }
      else if (type === 'clothoid') {
        const th0 = (i > 0 && segTypeAt(i - 1) === 'clothoid') ? jointHeading[i] : outHeading(i);
        const th1 = (i + 1 < segs && segTypeAt(i + 1) === 'clothoid') ? jointHeading[i + 1] : inHeading(i + 1);
        cloth = clothoidTable(p0, p1, th0, th1, steps); if (!cloth) effType = 'bezier';
      }
      if (effType === 'clothoid') clothoidSegments.add(i);
      for (let k = 0; k <= steps; k++) {
        if (i > 0 && k === 0) continue; // avoid dup at seg joints
        const t = k / steps;
        let pos, head, curv;
        if (effType === 'line') {
          pos = { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
          head = Math.atan2(p1.y - p0.y, p1.x - p0.x); curv = 0;
        } else if (effType === 'arc') {
          const ang = arc.a0 + arc.sweep * t;
          pos = { x: arc.Cx + arc.rad * Math.cos(ang), y: arc.Cy + arc.rad * Math.sin(ang) };
          head = ang + (arc.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);
          curv = arc.rad > 1e-6 ? 1 / arc.rad : 0;
        } else if (effType === 'clothoid') {
          pos = { x: cloth.xs[k], y: cloth.ys[k] }; head = cloth.hs[k]; curv = Math.abs(cloth.ks[k]);
        } else {
          pos = bez(p0, c0, c1, p1, t);
          const d = bezD(p0, c0, c1, p1, t), dd = bezDD(p0, c0, c1, p1, t);
          const speed2 = d.x * d.x + d.y * d.y, cross = d.x * dd.y - d.y * dd.x;
          head = Math.atan2(d.y, d.x); curv = speed2 > 1e-9 ? Math.abs(cross) / Math.pow(speed2, 1.5) : 0;
        }
        pts.push({ x: pos.x, y: pos.y, seg: i, t, heading: head, curv, s: 0 });
      }
    }

    // Blend curvature across adjacent clothoid joints. Position/heading already use a shared
    // tangent; this removes artificial velocity dips from independent curvature estimates.
    for (let j = 1; j < segs; j++) {
      if (!clothoidSegments.has(j - 1) || !clothoidSegments.has(j)) continue;
      const center = pts.findIndex((p) => p.seg === j - 1 && p.t > 1 - 1e-9);
      if (center < 0) continue;
      const next = Math.min(pts.length - 1, center + 1);
      const jointK = 0.5 * ((pts[center].curv || 0) + (pts[next].curv || 0));
      const span = Math.max(2, Math.round(steps * 0.16));
      for (let off = -span; off <= span; off++) {
        const idx = center + off;
        if (idx < 0 || idx >= pts.length) continue;
        if (!clothoidSegments.has(pts[idx].seg)) continue;
        const u = 1 - Math.min(1, Math.abs(off) / span);
        const w = u * u * (3 - 2 * u);
        pts[idx].curv = lerp(pts[idx].curv || 0, jointK, w);
      }
    }

    // arclength
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      s += Math.hypot(dx, dy);
      pts[i].s = s;
    }
    return { pts, length: s, segs };
  }`;

  return text.slice(0, start) + replacement + text.slice(end);
}

function transformLegacyJs(text) {
  if (!text.startsWith("// Bordeaux — app root.")) return text;

  text = text.split("Acquitaine").join("Autonomous Routine");

  text = replaceOnce(
    text,
    "  const clone = (o) => JSON.parse(JSON.stringify(o));\n",
    "  const clone = (o) => JSON.parse(JSON.stringify(o));\n  const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });\n",
    "legacy app clamp helper",
  );

  text = replaceOnce(
    text,
    "    const [project, setProject] = useState({\n      name: 'rebuilt-2687',\n      robot: { drive: 'swerve', w: 0.84, l: 0.84, maxSpeed: 5.0 },\n      paths: [pathLeaveReef(), pathReefStation(), pathStationReef()],\n    });",
    "    const [project, setProject] = useState({\n      schemaVersion: '1.0',\n      name: 'Untitled',\n      robot: { drive: 'swerve', w: 0.84, l: 0.84, maxSpeed: 5.0 },\n      paths: [blankPath('NewPath')],\n      routine: { name: 'Autonomous Routine', nodes: [] },\n      plannerId: 'profiledSpline',\n    });",
    "legacy default project",
  );

  text = replaceOnce(
    text,
    "    const [headMenu, setHeadMenu] = useState(null);\n\n    // ---- Autonomous Routine (auto routine) ----\n    const [routine, setRoutine] = useState(() => window.AUTO.demoRoutine());",
    "    const [headMenu, setHeadMenu] = useState(null);\n    const [plannerId, setPlannerId] = useState('profiledSpline');\n\n    // ---- Autonomous Routine ----\n    const [routine, setRoutine] = useState(() => ({ name: 'Autonomous Routine', nodes: [] }));",
    "legacy planner/routine state",
  );

  const demoStart = text.indexOf("  // ---- three distinct project paths:");
  const demoEnd = text.indexOf("  function blankPath", demoStart);
  if (demoStart >= 0 && demoEnd > demoStart) {
    text = `${text.slice(0, demoStart)}  // ---- blank startup path ----\n${text.slice(demoEnd)}`;
  }

  text = replaceOnce(
    text,
    "    const moveWaypoint = useCallback((i, p) => mutate((d) => {\n      const w = d.waypoints[i]; const dx = p.x - w.x, dy = p.y - w.y;\n      w.x = p.x; w.y = p.y; w.prevC.x += dx; w.prevC.y += dy; w.nextC.x += dx; w.nextC.y += dy; return d;\n    }), [mutate]);",
    "    const moveWaypoint = useCallback((i, p) => mutate((d) => {\n      p = clampWorld(p);\n      const w = d.waypoints[i]; const dx = p.x - w.x, dy = p.y - w.y;\n      w.x = p.x; w.y = p.y; w.prevC.x += dx; w.prevC.y += dy; w.nextC.x += dx; w.nextC.y += dy; return d;\n    }), [mutate]);",
    "legacy waypoint drag clamp",
  );

  text = replaceOnce(
    text,
    "    const addWaypoint = useCallback((p) => { commit((d) => {\n      const wps = d.waypoints; let insertAt = wps.length;",
    "    const addWaypoint = useCallback((p) => { commit((d) => {\n      p = clampWorld(p);\n      const wps = d.waypoints; let insertAt = wps.length;",
    "legacy add waypoint clamp",
  );

  text = replaceOnce(
    text,
    "    const setWp = useCallback((i, patch) => commit((d) => { Object.assign(d.waypoints[i], patch); return d; }), [commit]);",
    "    const setWp = useCallback((i, patch) => commit((d) => {\n      const w = d.waypoints[i];\n      if (patch.x != null || patch.y != null) {\n        const next = clampWorld({ x: patch.x != null ? patch.x : w.x, y: patch.y != null ? patch.y : w.y });\n        patch = { ...patch, x: next.x, y: next.y };\n      }\n      Object.assign(w, patch); return d;\n    }), [commit]);",
    "legacy inspector waypoint clamp",
  );

  text = replaceOnce(
    text,
    "    const delWp = useCallback((i) => { commit((d) => { d.waypoints.splice(i, 1); if (d.waypoints.length) { d.waypoints[0].thetaOn = true; d.waypoints[d.waypoints.length - 1].thetaOn = true; } return d; }); select(null, -1); }, [commit, select]);",
    "    const delWp = useCallback((i) => { commit((d) => { if (i <= 0 || i >= d.waypoints.length - 1) return d; d.waypoints.splice(i, 1); if (d.waypoints.length) { d.waypoints[0].thetaOn = true; d.waypoints[d.waypoints.length - 1].thetaOn = true; } return d; }); select(null, -1); }, [commit, select]);",
    "legacy start/end delete guard",
  );

  text = replaceOnce(
    text,
    "      src.x = Math.min(FIELD_W - 0.3, src.x + 0.4); src.y = Math.min(FIELD_H - 0.3, src.y + 0.4);",
    "      const next = clampWorld({ x: src.x + 0.4, y: src.y + 0.4 }); src.x = next.x; src.y = next.y;",
    "legacy duplicate waypoint clamp",
  );

  text = replaceOnce(
    text,
    "      const nw = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, linked: true, thetaOn: false, theta: 0, stop: false, segType: a.segType || 'bezier' };",
    "      const mid = clampWorld({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });\n      const nw = { x: mid.x, y: mid.y, linked: true, thetaOn: false, theta: 0, stop: false, segType: a.segType || 'bezier' };",
    "legacy insert waypoint clamp",
  );

  text = replaceOnce(
    text,
    "    const fieldActions = { addWaypoint, moveWaypoint, moveHandle, addTargetAt, addMarkerAt, moveTargetTo, moveMarkerTo, addRange, moveRangeHandle, beginHistory,\n      setWaypointHeading, headingMenu, faceWaypoint,\n      select: (k, i) => { if (k) beginHistory(); select(k, i); } };",
    "    const fieldActions = { addWaypoint, moveWaypoint, moveHandle, addTargetAt, addMarkerAt, moveTargetTo, moveMarkerTo, addRange, moveRangeHandle, beginHistory,\n      setWaypointHeading, headingMenu, faceWaypoint, delWp,\n      select: (k, i) => { if (k) beginHistory(); select(k, i); } };",
    "legacy field delete action",
  );

  text = replaceOnce(
    text,
    "    const delPath = (i) => { setProject((pr) => { const paths = pr.paths.filter((_, k) => k !== i); return { ...pr, paths }; }); setActiveIdx((a) => Math.max(0, a > i ? a - 1 : a === i ? Math.min(a, project.paths.length - 2) : a)); };\n    const setActive = (i) => { setActiveIdx(i); setSel({ kind: null, idx: -1 }); setPlayTime(0); setPlaying(false); hist.current = { past: [], future: [] }; };",
    "    const delPath = (i) => { if (project.paths.length <= 1) return; setProject((pr) => { const paths = pr.paths.filter((_, k) => k !== i); return { ...pr, paths }; }); setActiveIdx((a) => Math.max(0, a > i ? a - 1 : a === i ? Math.min(a, project.paths.length - 2) : a)); };\n    const renamePath = (i, name) => { const clean = (name || '').trim() || 'NewPath'; setProject((pr) => { const paths = pr.paths.slice(); paths[i] = { ...paths[i], name: clean }; return { ...pr, paths }; }); };\n    const setActive = (i) => { setActiveIdx(i); setSel({ kind: null, idx: -1 }); setPlayTime(0); setPlaying(false); hist.current = { past: [], future: [] }; };",
    "legacy path rename action",
  );

  const original = `    const onExport = () => {
      const out = { version: '2.0', name: doc.name, robot: project.robot, ...doc };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = doc.name + '.path'; a.click();
    };`;

  const replacement = `    const onExport = () => {
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
    };`;

  text = replaceOnce(text, original, replacement, "legacy app export handler");

  text = replaceOnce(
    text,
    "      h(window.Panels.Toolbar, { project, page, setPage, alliance, setAlliance, showGrid, setShowGrid, onUndo: undo, onRedo: redo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, times }),",
    "      h(window.Panels.Toolbar, { project, page, setPage, alliance, setAlliance, showGrid, setShowGrid, onUndo: undo, onRedo: redo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times, plannerId, setPlannerId }),",
    "legacy toolbar props",
  );

  text = replaceOnce(
    text,
    "              h(window.Panels.Overlay, { metric, setMetric, derived, diagOpen, onToggleDiag: () => setDiagOpen((o) => !o) }),",
    "              h(window.Panels.Overlay, { metric, setMetric, derived, diagOpen, onToggleDiag: () => setDiagOpen((o) => !o), plannerId }),",
    "legacy overlay planner props",
  );

  return text;
}

function transformFieldViewJs(text) {
  if (!text.startsWith("// Bordeaux — interactive field view")) return text;

  text = text.split("Acquitaine").join("Autonomous Routine");

  text = replaceOnce(
    text,
    "    const tf = useCallback((p) => flip ? { x: FIELD_W - p.x, y: FIELD_H - p.y } : p, [flip]);",
    "    const tf = useCallback((p) => flip ? { x: FIELD_W - p.x, y: FIELD_H - p.y } : p, [flip]);\n    const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });",
    "field clamp helper",
  );

  text = replaceOnce(
    text,
    "      return tf({ x: mx, y: my });",
    "      return clampWorld(tf({ x: mx, y: my }));",
    "field client-to-world clamp",
  );

  text = replaceOnce(
    text,
    "      if (role && role !== 'bg' && role !== 'ins') {\n        const idx = parseInt(t.getAttribute('data-idx'), 10);\n        drag.current = { role, idx, moved: false };",
    "      if (role && role !== 'bg' && role !== 'ins') {\n        const idx = parseInt(t.getAttribute('data-idx'), 10);\n        if (role === 'wp' && e.shiftKey && idx > 0 && idx < doc.waypoints.length - 1 && actions.delWp) { actions.delWp(idx); drag.current = null; return; }\n        drag.current = { role, idx, moved: false };",
    "field shift-click waypoint delete",
  );

  text = replaceOnce(
    text,
    "      const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));\n      const p = { x: cl(world.x, -1, FIELD_W + 1), y: cl(world.y, -1, FIELD_H + 1) };",
    "      const p = clampWorld(world);",
    "field drag clamp",
  );

  return text;
}

function transformPanelsJs(text) {
  if (!text.startsWith("// Bordeaux — chrome:")) return text;

  const start = text.indexOf("  // ---------------- path switcher ----------------");
  const end = text.indexOf("  // ---------------- top bar ----------------", start);
  if (start < 0 || end < 0) throw new Error("Could not find legacy path switcher");

  const replacement = `  // ---------------- path manager ----------------
  function PathSwitcher({ project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [focus, setFocus] = useState(activeIdx);
    const ref = useRef(null);
    useEffect(() => {
      if (!open) return;
      const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      window.addEventListener('pointerdown', away); return () => window.removeEventListener('pointerdown', away);
    }, [open]);
    useEffect(() => { if (open) setFocus(activeIdx); }, [open, activeIdx]);
    const cur = project.paths[activeIdx];
    const statsFor = (p, i) => {
      try {
        const d = window.PM.derivePath(p, project.robot, 24);
        return { time: times[i] != null ? times[i] : d.prof.totalTime || 0, len: d.sample.length || 0, warnings: (d.warnings || []).length };
      } catch (_) {
        return { time: times[i] || 0, len: 0, warnings: 1 };
      }
    };
    const filtered = project.paths.map((p, i) => ({ p, i, stats: statsFor(p, i) })).filter((row) => row.p.name.toLowerCase().includes(query.toLowerCase()));
    const pick = (i) => { setActive(i); setOpen(false); };
    const onKey = (e) => {
      if (!open) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => filtered.length ? filtered[Math.min(filtered.length - 1, Math.max(0, filtered.findIndex((r) => r.i === f)) + 1)].i : f); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => filtered.length ? filtered[Math.max(0, Math.max(0, filtered.findIndex((r) => r.i === f)) - 1)].i : f); }
      else if (e.key === 'Enter') { e.preventDefault(); if (filtered.some((r) => r.i === focus)) pick(focus); }
      else if (e.key === 'Escape') setOpen(false);
    };
    return h('div', { className: 'pathsw pathmgr', ref, onKeyDown: onKey },
      h('button', { className: 'pathsw-btn' + (open ? ' open' : ''), type: 'button', onClick: () => setOpen((o) => !o) },
        h('span', { className: 'pathsw-ic' }, h(Icon, { name: 'route', size: 15 })),
        h('span', { className: 'pathsw-nm' }, cur ? cur.name : 'No path'),
        h('span', { className: 'pathsw-t' }, (times[activeIdx] != null ? times[activeIdx].toFixed(2) : '--') + 's'),
        h('span', { className: 'pathsw-chev' }, h(Icon, { name: 'chevron', size: 14 }))),
      open && h('div', { className: 'pathsw-pop pathmgr-pop' },
        h('div', { className: 'pathsw-poph' }, 'Path Manager', h('span', null, project.paths.length)),
        h('input', { className: 'pathmgr-search', autoFocus: true, placeholder: 'Search paths', value: query, onChange: (e) => setQuery(e.target.value) }),
        cur && h('div', { className: 'pathmgr-rename' },
          h('span', null, 'Active'),
          h('input', { value: cur.name, onChange: (e) => renamePath(activeIdx, e.target.value), onClick: (e) => e.stopPropagation() })),
        h('div', { className: 'pathsw-list pathmgr-list' }, filtered.length ? filtered.map(({ p, i, stats }) =>
          h('div', { key: i, className: 'pathsw-row pathmgr-row' + (i === activeIdx ? ' on' : '') + (i === focus ? ' focus' : ''), onMouseEnter: () => setFocus(i), onClick: () => pick(i) },
            h('span', { className: 'pathsw-rowic' }, h(Icon, { name: 'route', size: 14 })),
            h('span', { className: 'pathsw-rownm' }, p.name),
            h('span', { className: 'pathmgr-stats' }, stats.len.toFixed(1) + 'm', h('b', null, stats.time.toFixed(2) + 's'), stats.warnings ? h('em', null, stats.warnings) : null),
            h('button', { className: 'rowbtn', title: 'Duplicate', onClick: (e) => { e.stopPropagation(); dupPath(i); } }, h(Icon, { name: 'copy', size: 13 })),
            project.paths.length > 1 && h('button', { className: 'rowbtn danger', title: 'Delete', onClick: (e) => { e.stopPropagation(); delPath(i); } }, h(Icon, { name: 'trash', size: 13 }))))
          : h('div', { className: 'featempty' }, 'No matching paths')),
        h('button', { className: 'pathsw-add', type: 'button', onClick: () => { addPath(); setOpen(false); } }, h(Icon, { name: 'plus', size: 14 }), 'New path')));
  }

  function PlannerSelect({ plannerId, setPlannerId }) {
    return h('div', { className: 'plannerselect', title: 'Planner used for .bdx export' },
      h('span', null, 'Planner'),
      h('select', { value: plannerId, onChange: (e) => setPlannerId(e.target.value) },
        h('option', { value: 'profiledSpline' }, 'Profiled spline'),
        h('option', { value: 'optimizedTrajectory' }, 'Optimized trajectory (experimental)')));
  }

`;

  text = text.slice(0, start) + replacement + text.slice(end);

  text = replaceOnce(
    text,
    "      onUndo, onRedo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, times } = props;",
    "      onUndo, onRedo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times, plannerId, setPlannerId } = props;",
    "toolbar prop destructuring",
  );

  text = replaceOnce(
    text,
    "        plan && h(PathSwitcher, { project, activeIdx, setActive, addPath, dupPath, delPath, times })),",
    "        plan && h(PathSwitcher, { project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times })),",
    "toolbar path manager props",
  );

  text = replaceOnce(
    text,
    "          h('div', { className: 'tbdiv' })),",
    "          h('div', { className: 'tbdiv' }),\n          h(PlannerSelect, { plannerId, setPlannerId })),",
    "toolbar planner selector",
  );

  text = replaceOnce(
    text,
    "  function Overlay({ metric, setMetric, derived, diagOpen, onToggleDiag }) {",
    "  function Overlay({ metric, setMetric, derived, diagOpen, onToggleDiag, plannerId }) {",
    "overlay planner prop",
  );

  text = replaceOnce(
    text,
    "      h('button', { className: 'ovsafety' + (warns.length ? (high ? ' bad' : ' warn') : ' ok') + (diagOpen ? ' open' : ''), type: 'button', onClick: onToggleDiag, title: warns.length ? 'Open diagnostics' : 'No issues' },",
    "      plannerId === 'optimizedTrajectory' && h('div', { className: 'plannerdiag' }, h('b', null, 'Optimized'), h('span', null, 'export planner'), h('em', null, 'baseline timing pass')),\n      h('button', { className: 'ovsafety' + (warns.length ? (high ? ' bad' : ' warn') : ' ok') + (diagOpen ? ' open' : ''), type: 'button', onClick: onToggleDiag, title: warns.length ? 'Open diagnostics' : 'No issues' },",
    "overlay planner diagnostics",
  );

  return text;
}

function transformCopyJs(text) {
  return text.split("Acquitaine").join("Autonomous Routine");
}

function extForMime(mime) {
  if (mime === "application/javascript" || mime === "text/javascript") return ".js";
  if (mime === "image/png") return ".png";
  if (mime === "font/woff2") return ".woff2";
  return ".bin";
}

let wrotePm = false;
let wroteField = false;
let legacyTemplate = template;
const legacyRoot = path.join(root, "public/legacy");
const legacyAssets = path.join(legacyRoot, "assets");

fs.rmSync(legacyRoot, { recursive: true, force: true });
fs.mkdirSync(legacyAssets, { recursive: true });

for (const [id, entry] of Object.entries(manifest)) {
  const bytes = bytesFor(entry);
  const filename = `${id}${extForMime(entry.mime)}`;
  const legacyBytes = entry.mime.includes("javascript")
    ? Buffer.from(
        transformLegacyJs(
          transformPanelsJs(transformFieldViewJs(transformCopyJs(transformMathJs(bytes.toString("utf8"))))),
        ),
        "utf8",
      )
    : bytes;
  fs.writeFileSync(path.join(legacyAssets, filename), legacyBytes);
  legacyTemplate = legacyTemplate.split(id).join(`assets/${filename}`);

  if (entry.mime === "application/javascript") {
    const text = bytes.toString("utf8");
    if (text.startsWith("// Bordeaux — path math engine")) {
      writeGeneratedPm(id, text);
      wrotePm = true;
    }
  }

  if (entry.mime === "image/png" && !wroteField) {
    fs.writeFileSync(path.join(root, "public/field.png"), bytes);
    wroteField = true;
  }
}

if (!wrotePm) throw new Error("Could not extract PM math engine");
if (!wroteField) throw new Error("Could not extract field image");

const extResourcesMatch = html.match(
  /<script type="__bundler\/ext_resources">([\s\S]*?)<\/script>/,
);
const extResources = extResourcesMatch ? JSON.parse(extResourcesMatch[1]) : [];
const resourceMap = {};
for (const entry of extResources) {
  resourceMap[entry.id] = `assets/${entry.uuid}${extForMime(manifest[entry.uuid].mime)}`;
}
const resourceScript = `<script>window.__resources = ${JSON.stringify(resourceMap).replace(/<\//g, "<\\/")};<\/script>`;
const polishStyle = `<style id="bordeaux-polish">
:root {
  --panel-border-strong: rgba(255,255,255,0.13);
  --panel-soft: rgba(255,255,255,0.045);
}
.toolbar {
  border-bottom-color: var(--panel-border-strong) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,0.045), 0 18px 34px rgba(0,0,0,0.18);
}
.brand-name { letter-spacing: 0 !important; }
.pathsw-btn, .exportbtn, .qbtn, .facebtn, .toolrail-b, .themebtn, .alliance {
  transition: border-color .14s ease, background .14s ease, transform .08s ease, color .14s ease;
}
.pathsw-btn:hover, .exportbtn:hover, .qbtn:hover, .facebtn:hover, .themebtn:hover, .alliance:hover {
  border-color: rgba(255,255,255,0.18) !important;
  background: rgba(255,255,255,0.07) !important;
}
.pathmgr-pop {
  width: 390px !important;
  padding: 10px !important;
}
.pathmgr-search, .pathmgr-rename input {
  width: 100%;
  box-sizing: border-box;
  color: var(--text);
  background: rgba(0,0,0,0.18);
  border: 1px solid rgba(255,255,255,0.11);
  border-radius: 6px;
  padding: 8px 10px;
  outline: none;
}
.pathmgr-search:focus, .pathmgr-rename input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}
.pathmgr-rename {
  display: grid;
  grid-template-columns: 54px 1fr;
  align-items: center;
  gap: 8px;
  margin: 9px 0;
  color: var(--muted);
  font-size: 12px;
}
.pathmgr-list { max-height: 310px !important; }
.pathmgr-row {
  grid-template-columns: 22px minmax(0,1fr) auto 26px 26px !important;
