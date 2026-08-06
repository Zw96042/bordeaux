// Bordeaux — chrome: top bar, path switcher, tool rail, outline, constraint chip bar,
// metric overlay, path-check drawer, telemetry/transport, view controls.
// Needs React + window.UI + window.PM. Exports window.Panels
(function () {
  const { useRef, useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { Icon, IconBtn, Section, Num, Seg, constraintRangeSummary } = window.UI;
  const R2D = 180 / Math.PI;

  // ---------------- path manager ----------------
  function PathLibrary({ project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [collapsed, setCollapsed] = useState({});
    const [editing, setEditing] = useState(null);
    const [menu, setMenu] = useState(null);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const triggerRef = useRef(null), panelRef = useRef(null), searchRef = useRef(null), editRef = useRef(null), editOriginRef = useRef(null);
    const cur = project.paths[activeIdx], folders = project.pathFolders || [];
    const close = () => {
      setOpen(false); setMenu(null); setEditing(null); setError('');
      editOriginRef.current = null;
      requestAnimationFrame(() => triggerRef.current && triggerRef.current.focus());
    };
    const finishEdit = () => {
      setEditing(null); setError('');
    };
    useEffect(() => {
      if (open) requestAnimationFrame(() => searchRef.current && searchRef.current.focus());
    }, [open]);
    useEffect(() => {
      if (!open) return;
      const onKey = (e) => {
        if (e.key === '/' && !editing) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (editing) finishEdit();
        else if (menu) setMenu(null);
        else if (query) setQuery('');
        else close();
      };
      window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
    }, [open, editing, menu, query]);
    useEffect(() => {
      if (!menu) return;
      const actionId = (menu.kind === 'path' ? 'path-actions-' : 'folder-actions-') + menu.id;
      requestAnimationFrame(() => {
        const action = document.getElementById(actionId);
        if (action) action.scrollIntoView({ block: 'nearest' });
      });
      const away = (e) => {
        if (!(e.target instanceof Element) || !e.target.closest('.pathlib-actionmenu,.pathlib-more')) setMenu(null);
      };
      window.addEventListener('pointerdown', away); return () => window.removeEventListener('pointerdown', away);
    }, [menu]);
    const trapFocus = (e) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    useEffect(() => { if (editing) requestAnimationFrame(() => { if (editRef.current) { editRef.current.focus(); editRef.current.select(); } }); }, [editing]);
    useEffect(() => { if (open && !editing) requestAnimationFrame(() => { if (panelRef.current) panelRef.current.focus({ preventScroll: true }); }); }, [open]);
    useEffect(() => {
      if (!open || editing || !editOriginRef.current) return;
      const origin = editOriginRef.current;
      const controlId = (origin.kind === 'path' ? 'path-actions-' : 'folder-actions-') + origin.id;
      const trigger = panelRef.current && Array.from(panelRef.current.querySelectorAll('[aria-controls]')).find((node) => node.getAttribute('aria-controls') === controlId);
      editOriginRef.current = null;
      const target = trigger || searchRef.current;
      if (target) target.focus();
    }, [open, editing]);
    const folderName = (id) => (folders.find((folder) => folder.id === id) || {}).name || 'Unfiled';
    const beginEdit = (kind, id, name) => { editOriginRef.current = { kind, id }; setMenu(null); setEditing({ kind, id }); setDraft(name); setError(''); };
    const submitEdit = (e) => {
      e.preventDefault(); const clean = draft.trim(); if (!clean) { setError('Enter a name.'); return; }
      if (editing.kind === 'path') renamePath(project.paths.findIndex((path) => path.id === editing.id), clean);
      else renamePathFolder(editing.id, clean);
      finishEdit();
    };
    const editForm = () => h('form', { className: 'pathlib-rename', onSubmit: submitEdit },
      h('label', { className: 'sr-only', htmlFor: 'path-library-name' }, 'Name'),
      h('input', { id: 'path-library-name', ref: editRef, value: draft, autoComplete: 'off', spellCheck: false, 'aria-invalid': !!error, 'aria-describedby': error ? 'path-library-name-error' : undefined, onChange: (e) => { setDraft(e.target.value); setError(''); } }),
      h('button', { type: 'submit' }, 'Save'), h('button', { type: 'button', onClick: finishEdit }, 'Cancel'),
      error && h('span', { id: 'path-library-name-error', className: 'pathlib-error', role: 'status' }, error));
    const pathActions = (path, index) => h('div', { id: 'path-actions-' + path.id, className: 'pathlib-actionmenu', role: 'group', 'aria-label': path.name + ' actions' },
      h('div', { className: 'pathlib-actionrow' },
  }

  // ---------------- top bar ----------------
  function Toolbar(props) {
    const { project, page, setPage, alliance, setAlliance, showGrid, setShowGrid,
      onUndo, onRedo, onExport, theme, setTheme, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times, plannerId, setPlannerId } = props;
    const plan = page === 'plan';
    return h('div', { className: 'toolbar' },
      h('div', { className: 'tb-left' },
        h('div', { className: 'brand' }, h('span', { className: 'brand-mark' }), h('span', { className: 'brand-name' }, 'Bordeaux')),
        h('div', { className: 'pageswitch' },
          h('button', { className: plan ? 'on' : '', type: 'button', onClick: () => setPage('plan') }, h(Icon, { name: 'route', size: 15 }), 'Plan'),
          h('button', { className: page === 'auto' ? 'on' : '', type: 'button', onClick: () => setPage('auto') }, h(Icon, { name: 'layers', size: 15 }), 'Auto'),
          h('button', { className: page === 'robot' ? 'on' : '', type: 'button', onClick: () => setPage('robot') }, h(Icon, { name: 'car', size: 15 }), 'Robot')),
        plan && h(PathSwitcher, { project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, times })),

      h('div', { className: 'tb-right' },
        plan && h(React.Fragment, null,
          h(IconBtn, { icon: 'undo', onClick: onUndo, title: 'Undo  (\u2318Z)' }),
          h(IconBtn, { icon: 'redo', onClick: onRedo, title: 'Redo  (\u21e7\u2318Z)' }),
          h('div', { className: 'tbdiv' }),
          h(PlannerSelect, { plannerId, setPlannerId })),
        (plan || page === 'auto') && h(React.Fragment, null,
          h('button', { className: 'alliance ' + alliance, type: 'button', onClick: () => setAlliance(alliance === 'blue' ? 'red' : 'blue'), title: 'Flip alliance' },
            h('span', { className: 'alliance-dot' }), alliance === 'blue' ? 'Blue' : 'Red'),
          h(IconBtn, { icon: 'grid', active: showGrid, onClick: () => setShowGrid(!showGrid), title: 'Grid  (G)' })),
        h(ThemePicker, { theme, setTheme }),
        (plan || page === 'auto') && h('button', { className: 'exportbtn', type: 'button', onClick: onExport }, h(Icon, { name: 'share', size: 15 }), page === 'auto' ? 'Deploy' : 'Export')));
  }

  // ---------------- canvas tool rail (left edge) — spatial creation (memo §2) ----------------
  const TOOLS = [
    { id: 'select', icon: 'select', label: 'Select / move', key: 'V' },
    { id: 'waypoint', icon: 'waypoint', label: 'Place waypoint', key: 'W' },
    { id: 'rotation', icon: 'rotation', label: 'Rotation target', key: 'R' },
    { id: 'marker', icon: 'flag2', label: 'Event marker', key: 'M' },
    { id: 'range', icon: 'gauge', label: 'Constraint range', key: 'C' },
  ];
  function ToolRail({ tool, setTool }) {
    return h('div', { className: 'toolrail' }, TOOLS.map((t) =>
      h('button', { key: t.id, className: 'toolrail-b' + (tool === t.id ? ' on' : ''), type: 'button', title: t.label + '  (' + t.key + ')', onClick: () => setTool(t.id) },
        h(Icon, { name: t.icon, size: 18 }), h('span', { className: 'toolrail-k' }, t.key))));
  }

  // ---------------- global-constraint chip bar (top of canvas) — memo §6 ----------------
  function ConstraintBar({ c, robot, active, onOpen }) {
    const chips = [
      { k: 'Max V', v: Math.min(c.maxVel, robot.maxSpeed).toFixed(1), u: 'm/s' },
      { k: 'Max A', v: c.maxAccel.toFixed(1), u: 'm/s\u00b2' },
      { k: 'Decel', v: (c.maxDecel != null ? c.maxDecel : c.maxAccel).toFixed(1), u: 'm/s\u00b2' },
      { k: 'Max \u03c9', v: (c.maxAngVel || 0).toFixed(0), u: '\u00b0/s' },
    ];
    return h('button', { className: 'cbar' + (active ? ' active' : ''), type: 'button', title: 'Edit global constraints in the inspector', onClick: onOpen },
      h('span', { className: 'cbar-ic' }, h(Icon, { name: 'gauge', size: 14 })),
      chips.map((ch, i) => h('span', { key: i, className: 'cbar-chip' },
        h('span', { className: 'cbar-k' }, ch.k),
        h('span', { className: 'cbar-v' }, ch.v),
        h('span', { className: 'cbar-u' }, ch.u))),
      h('span', { className: 'cbar-edit' }, active ? 'Editing' : 'Edit'));
  }

  // ---------------- outline: document STRUCTURE only (memo §5 / §7) ----------------
  const behPill = (w) => w.stop ? { t: w.wait ? 'stop ' + (w.wait) + 's' : 'stop', c: 'r' } : w.corner ? { t: 'corner', c: 'n' } : null;

  function WaypointList({ wps, sel, actions }) {
    const [drag, setDrag] = useState(null);
    const rows = useRef([]);
    const startDrag = (i) => (e) => {
      e.preventDefault(); e.stopPropagation();
      setDrag({ from: i, over: i });
      const mv = (ev) => {
        let over = 0;
        rows.current.forEach((el, k) => { if (!el) return; const r = el.getBoundingClientRect(); if (ev.clientY > r.top + r.height / 2) over = k + 1; });
        over = Math.max(0, Math.min(wps.length - 1, over));
        setDrag((d) => (d && d.over === over) ? d : (d ? { ...d, over } : d));
      };
      const up = () => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        setDrag((d) => { if (d && d.from !== d.over) actions.reorderWp(d.from, d.over); return null; });
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };
    return h('div', { className: 'wplist' + (drag ? ' dragging' : '') }, wps.map((w, i) => {
      const label = i === 0 ? 'Start' : i === wps.length - 1 ? 'End' : 'Waypoint ' + i;
      const mid = i !== 0 && i !== wps.length - 1;
      const bp = behPill(w);
      const cls = 'featrow' + (sel.kind === 'wp' && sel.idx === i ? ' sel' : '') + (drag && drag.from === i ? ' dragging' : '') + (drag && drag.over === i && drag.from !== i ? ' over' : '');
      return h('div', { key: i, ref: (el) => (rows.current[i] = el), className: cls, onClick: () => actions.select('wp', i) },
        h('span', { className: 'featgrip', title: 'Drag to reorder', onPointerDown: startDrag(i), onClick: (e) => e.stopPropagation() }, h(Icon, { name: 'drag', size: 13 })),
        h('span', { className: 'featdot ' + (w.stop ? 'r sq' : i === 0 ? 'g' : i === wps.length - 1 ? 'r' : 'b') }),
        h('span', { className: 'featnm' }, label),
        mid && w.thetaOn && h('span', { className: 'pill th' }, (w.theta || 0).toFixed(0) + '\u00b0'),
        bp ? h('span', { className: 'pill ' + bp.c }, bp.t) : h('span', { className: 'featmeta' }, w.x.toFixed(1) + ', ' + w.y.toFixed(1)),
        mid && h('button', { className: 'featdel', title: 'Delete', onClick: (e) => { e.stopPropagation(); actions.delWp(i); } }, h(Icon, { name: 'trash', size: 12 })));
    }));
  }

  function SegmentList({ wps, sel, actions }) {
    if (wps.length < 2) return h('div', { className: 'featempty' }, 'Add a second waypoint to form a segment');
    const name = (k) => k === 0 ? 'Start' : k === wps.length - 1 ? 'End' : 'WP' + k;
    const abbr = (id) => (window.PM.SEGTYPES.find((s) => s.id === id) || window.PM.SEGTYPES[2]).abbr;
    return h(React.Fragment, null, wps.slice(0, -1).map((w, i) =>
      h('div', { key: i, className: 'featrow' + (sel.kind === 'seg' && sel.idx === i ? ' sel' : ''), onClick: () => actions.select('seg', i) },
        h('span', { className: 'featdot b' }),
        h('span', { className: 'featnm' }, name(i) + ' \u2192 ' + name(i + 1)),
        h('span', { className: 'segabbr' }, abbr(w.segType)))));
  }

  function Outline({ open, setOpen, doc, sel, actions, secOpen, setSecOpen }) {
    const tog = (k) => setSecOpen((o) => ({ ...o, [k]: !o[k] }));
    const wps = doc.waypoints;
    if (!open) {
      return h('button', { className: 'outline-tab', type: 'button', title: 'Show outline', onClick: () => setOpen(true) },
        h(Icon, { name: 'zones', size: 16 }), h('span', null, 'Outline'));
    }
    return h('div', { className: 'outline' },
      h('div', { className: 'outline-hd' },
        h('span', { className: 'outline-t' }, 'Outline'),
        h('button', { className: 'mini', type: 'button', title: 'Hide outline', onClick: () => setOpen(false) }, h('span', { className: 'rot90' }, h(Icon, { name: 'chevron', size: 15 })))),
      h('div', { className: 'outline-scroll' },
        h('div', { className: 'outline-grp' }, 'Geometry'),
        h(Section, { icon: 'waypoint', title: 'Waypoints', count: wps.length, open: secOpen.wp, onToggle: () => tog('wp'),
          right: h('button', { className: 'mini', type: 'button', title: 'Add waypoint', onClick: (e) => { e.stopPropagation(); actions.addWaypointEnd(); } }, h(Icon, { name: 'plus', size: 13 })) },
          h(WaypointList, { wps, sel, actions })),
        h(Section, { icon: 'route', title: 'Segments', count: Math.max(0, wps.length - 1), open: !!secOpen.sg, onToggle: () => tog('sg') },
          h(SegmentList, { wps, sel, actions })),
        h('div', { className: 'outline-grp' }, 'Motion'),
        h(Section, { icon: 'rotation', title: 'Rotation Targets', count: doc.targets.length, open: secOpen.rt, onToggle: () => tog('rt'),
          right: h('button', { className: 'mini', type: 'button', title: 'Place on path — R then click', onClick: (e) => { e.stopPropagation(); actions.setTool('rotation'); } }, h(Icon, { name: 'plus', size: 13 })) },
          doc.targets.length === 0 ? h('div', { className: 'featempty' }, 'None · press R, click the path') :
            doc.targets.map((t, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'rt' && sel.idx === i ? ' sel' : ''), onClick: () => actions.select('rt', i) },
              h('span', { className: 'featdot n' }), h('span', { className: 'featnm' }, t.deg.toFixed(0) + '\u00b0'), h('span', { className: 'featmeta' }, (t.f * 100).toFixed(0) + '%'),
              h('button', { className: 'featdel', title: 'Delete', onClick: (e) => { e.stopPropagation(); actions.delTarget(i); } }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'flag2', title: 'Event Markers', count: doc.markers.length, open: secOpen.em, onToggle: () => tog('em'),
          right: h('button', { className: 'mini', type: 'button', title: 'Place on path — M then click', onClick: (e) => { e.stopPropagation(); actions.setTool('marker'); } }, h(Icon, { name: 'plus', size: 13 })) },
          doc.markers.length === 0 ? h('div', { className: 'featempty' }, 'None · press M, click the path') :
            doc.markers.map((m, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'em' && sel.idx === i ? ' sel' : ''), onClick: () => actions.select('em', i) },
              h('span', { className: 'featdot n' }), h('span', { className: 'featnm' }, m.name), h('span', { className: 'featmeta' }, m.cmd),
              h('button', { className: 'featdel', title: 'Delete', onClick: (e) => { e.stopPropagation(); actions.delMarker(i); } }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'gauge', title: 'Constraint Ranges', count: (doc.ranges || []).length, open: secOpen.cr !== false, onToggle: () => tog('cr'),
          right: h('button', { className: 'mini', type: 'button', title: 'Drag along the path — C then drag', onClick: (e) => { e.stopPropagation(); actions.setTool('range'); } }, h(Icon, { name: 'plus', size: 13 })) },
          (doc.ranges || []).length === 0 ? h('div', { className: 'featempty' }, 'None · press C, drag the path') :
            doc.ranges.map((rg, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'cr' && sel.idx === i ? ' sel' : ''), onClick: () => actions.select('cr', i) },
              h('span', { className: 'featdot w' }), h('span', { className: 'featnm' }, '\u2264' + rg.maxVel.toFixed(1) + ' m/s'), h('span', { className: 'featmeta' }, (Math.min(rg.f0, rg.f1) * 100).toFixed(0) + '\u2013' + (Math.max(rg.f0, rg.f1) * 100).toFixed(0) + '%'),
              h('button', { className: 'featdel', title: 'Delete', onClick: (e) => { e.stopPropagation(); actions.delRange(i); } }, h(Icon, { name: 'trash', size: 12 }))))),
        h('div', { className: 'outline-foot' }, 'Constraints & summary live in the inspector \u2192')));
  }

  // ---------------- metric overlay + legend (bottom-left) ----------------
  function Overlay({ metric, setMetric, derived, diagOpen, onToggleDiag, plannerId }) {
    const M = derived.metrics || {};
    const warns = derived.warnings || [];
    const grad = window.PM.metricGradient(metric);
    const def = (window.PM.METRICS || []).find((m) => m.id === metric) || {};
    let lo = '0', hi = '0';
    if (metric === 'velocity') { lo = '0'; hi = (M.vMax || 0).toFixed(1); }
    else if (metric === 'accel') { const a = (M.aMax || 0).toFixed(1); lo = '-' + a; hi = '+' + a; }
    else if (metric === 'angvel') { const w = ((M.wMax || 0) * R2D).toFixed(0); lo = '-' + w; hi = '+' + w; }
    else { lo = '0'; hi = (M.kMax || 0).toFixed(2); }
    const high = warns.filter((w) => w.sev === 'high').length;
    return h('div', { className: 'overlayctl' },
      h('div', { className: 'ovrow' },
        h('span', { className: 'ovlabel' }, 'Overlay'),
        h('div', { className: 'ovselwrap' },
          h('select', { className: 'ovselect', value: metric, onChange: (e) => setMetric(e.target.value) },
            (window.PM.METRICS || []).map((m) => h('option', { key: m.id, value: m.id }, m.label))),
          h('span', { className: 'ovchev' }, h(Icon, { name: 'chevron', size: 13 })))),
      h('div', { className: 'ovlegend' },
        h('div', { className: 'ovbar', style: { background: grad } }),
        h('div', { className: 'ovscale' },
          h('span', null, lo), h('span', { className: 'ovunit' }, def.unit || ''), h('span', null, hi))),
      plannerId === 'optimizedTrajectory' && h('div', { className: 'plannerdiag' }, h('b', null, 'Optimized'), h('span', null, 'export planner'), h('em', null, 'baseline timing pass')),
      h('button', { className: 'ovsafety' + (warns.length ? (high ? ' bad' : ' warn') : ' ok') + (diagOpen ? ' open' : ''), type: 'button', onClick: onToggleDiag, title: warns.length ? 'Open diagnostics' : 'No issues' },
        h('span', { className: 'ovsafety-dot' }),
        warns.length === 0
          ? h('span', null, 'No curvature or velocity spikes')
          : h('span', null, warns.length + (warns.length > 1 ? ' checks' : ' check') + (high ? ' \u00b7 ' + high + ' critical' : '')),
        warns.length > 0 && h('span', { className: 'ovsafety-go' }, h(Icon, { name: 'chevron', size: 13 }))));
  }

  // ---------------- diagnostics drawer (memo §9) ----------------
  function Diagnostics({ derived, doc, onClose, onPick, onFix }) {
    const warns = derived.warnings || [];
    const n = doc.waypoints.length;
    const segName = (s) => (s === 0 ? 'Start' : 'WP' + s) + ' \u2192 ' + (s + 1 === n - 1 ? 'End' : 'WP' + (s + 1));
    return h('div', { className: 'diag' },
      h('div', { className: 'diag-hd' },
        h('span', { className: 'diag-t' }, 'Diagnostics'),
        h('span', { className: 'diag-c' }, warns.length),
        h('button', { className: 'ctxinsp-x', type: 'button', title: 'Close', onClick: onClose }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'diag-scroll' },
        warns.length === 0
          ? h('div', { className: 'diag-empty' }, h(Icon, { name: 'check', size: 16 }), 'No curvature or velocity issues detected on this path.')
          : warns.map((w, i) => h('div', { key: i, className: 'diag-row' },
              h('button', { className: 'diag-main', type: 'button', onClick: () => onPick(w) },
                h('span', { className: 'diag-sev ' + (w.sev === 'high' ? 'high' : 'med') }),
                h('div', { className: 'diag-body' },
                  h('div', { className: 'diag-txt' }, w.text),
                  h('div', { className: 'diag-loc' }, segName(w.seg))),
                h('span', { className: 'diag-pin' }, h(Icon, { name: 'pin', size: 13 }))),
              h('div', { className: 'diag-fixes' }, (w.fixes || []).map((f, k) =>
                h('button', { key: k, className: 'diag-fix', type: 'button', onClick: () => onFix(w, f.id) }, f.label)))))));
  }

  // ---------------- telemetry graph + transport ----------------
  function Transport({ derived, metric, playTime, playing, setPlaying, seek, restart, graphOpen, setGraphOpen }) {
    const total = derived.prof.totalTime || 0.001;
    const pct = Math.max(0, Math.min(1, playTime / total));
    const graphRef = useRef(null);
    const prof = derived.prof, pts = derived.sample.pts, M = derived.metrics;

    let arr = M.v, vmin = 0, vmax = M.vMax || 1, signed = false, unit = 'm/s', title = 'Velocity';
    if (metric === 'accel') { arr = M.accel; vmax = M.aMax || 1; vmin = -vmax; signed = true; unit = 'm/s\u00b2'; title = 'Acceleration'; }
    else if (metric === 'angvel') { arr = (M.omega || []).map((o) => o * R2D); vmax = (M.wMax || 0.01) * R2D; vmin = -vmax; signed = true; unit = '\u00b0/s'; title = 'Angular velocity'; }
    else if (metric === 'curvature') { arr = M.curv; vmin = 0; vmax = M.kMax || 0.01; unit = '1/m'; title = 'Curvature'; }

    const GW = 1000, GH = 132, padL = 4, padR = 4, padT = 10, padB = 16;
    const span = Math.max(1e-6, vmax - vmin);
    const yOf = (val) => padT + (1 - (val - vmin) / span) * (GH - padT - padB);
    const zeroY = yOf(0);
    let poly = '';
    if (pts.length > 1 && arr && arr.length) {
      const N = 170;
      for (let k = 0; k <= N; k++) {
        const tt = (k / N) * total;
        let lo = 1, hi = prof.t.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (prof.t[mid] < tt) lo = mid + 1; else hi = mid; }
        const t0 = prof.t[lo - 1], t1 = prof.t[lo]; const u = t1 - t0 > 1e-6 ? (tt - t0) / (t1 - t0) : 0;
        const val = arr[lo - 1] + (arr[lo] - arr[lo - 1]) * u;
        const x = padL + (k / N) * (GW - padL - padR);
        poly += (k === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + yOf(val).toFixed(1) + ' ';
      }
    }
    const baseY = signed ? zeroY : (GH - padB);
    const playX = padL + pct * (GW - padL - padR);
    const onGraphDown = (e) => {
      const seekTo = (cx) => { const r = graphRef.current.getBoundingClientRect(); const f = Math.max(0, Math.min(1, (cx - r.left) / r.width)); seek(f * total); };
      seekTo(e.clientX);
      const mv = (ev) => seekTo(ev.clientX);
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    };

    return h(React.Fragment, null,
      graphOpen && h('div', { className: 'velgraph' },
        h('div', { className: 'velgraph-top' },
          h('span', { className: 'velgraph-ttl' }, title),
          h('span', { className: 'velgraph-mx' }, (signed ? '\u00b1' + vmax.toFixed(metric === 'angvel' ? 0 : 1) : vmax.toFixed(metric === 'curvature' ? 2 : 1)) + ' ' + unit)),
        h('div', { className: 'velgraph-plot' },
          h('div', { className: 'velgraph-yaxis' },
            h('span', null, (metric === 'curvature' ? vmax.toFixed(2) : vmax.toFixed(metric === 'angvel' ? 0 : 1))),
            h('span', null, signed ? '0' : (vmax / 2).toFixed(metric === 'angvel' ? 0 : 1)),
            h('span', null, signed ? '-' + vmax.toFixed(metric === 'angvel' ? 0 : 1) : '0')),
          h('svg', { ref: graphRef, className: 'velgraph-svg', viewBox: `0 0 ${GW} ${GH}`, preserveAspectRatio: 'none', onPointerDown: onGraphDown },
            [0.25, 0.5, 0.75].map((g) => h('line', { key: g, x1: padL, x2: GW - padR, y1: padT + g * (GH - padT - padB), y2: padT + g * (GH - padT - padB), stroke: '#ffffff', strokeOpacity: 0.05, strokeWidth: 1 })),
            signed && h('line', { x1: padL, x2: GW - padR, y1: zeroY, y2: zeroY, stroke: '#ffffff', strokeOpacity: 0.16, strokeWidth: 1 }),
            !signed && h('line', { x1: padL, x2: GW - padR, y1: GH - padB, y2: GH - padB, stroke: '#ffffff', strokeOpacity: 0.12, strokeWidth: 1 }),
            poly && h('path', { d: poly + `L ${GW - padR} ${baseY} L ${padL} ${baseY} Z`, fill: 'var(--accent)', fillOpacity: 0.12 }),
            poly && h('path', { d: poly, fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: playX, x2: playX, y1: padT - 5, y2: GH - padB, stroke: '#fff', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' }),
            h('circle', { cx: playX, cy: padT - 5, r: 3.5, fill: '#fff' })))),
      h('div', { className: 'transport' },
        h('button', { className: 'tbtn', type: 'button', onClick: restart, title: 'Restart' }, h(Icon, { name: 'rewind', size: 16 })),
        h('button', { className: 'tbtn play', type: 'button', onClick: () => setPlaying(!playing), title: 'Play / Pause  (Space)' }, h(Icon, { name: playing ? 'pause' : 'play', size: 17, fill: true })),
        h('div', { className: 'scrubwrap' },
          h('div', { className: 'timecode' }, fmt(playTime)),
          h('input', { className: 'scrub', type: 'range', min: 0, max: 1000, value: Math.round(pct * 1000), onChange: (e) => seek((e.target.value / 1000) * total) }),
          h('div', { className: 'timecode dim' }, fmt(total))),
        h('div', { className: 'tbdiv' }),
        h('div', { className: 'roi' }, h('span', { className: 'roi-v' }, derived.sample.length.toFixed(2)), h('span', { className: 'roi-u' }, 'm')),
        h(IconBtn, { icon: 'gauge', active: graphOpen, onClick: () => setGraphOpen(!graphOpen), title: 'Telemetry graph' })));
  }

  // ---------------- zoom / view controls ----------------
  function ViewControls({ zoomPct, zoomBy, onFit }) {
    return h('div', { className: 'viewctl' },
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom out', onClick: () => zoomBy(1.18) }, h(Icon, { name: 'zoomout', size: 16 })),
      h('button', { className: 'vc-pct', type: 'button', title: 'Fit field  (F)', onClick: onFit }, zoomPct + '%'),
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom in', onClick: () => zoomBy(1 / 1.18) }, h(Icon, { name: 'zoomin', size: 16 })),
      h('div', { className: 'vc-div' }),
      h('button', { className: 'vc-btn', type: 'button', title: 'Fit field  (F)', onClick: onFit }, h(Icon, { name: 'fit', size: 16 })));
  }

  function fmt(t) { return (t || 0).toFixed(2) + 's'; }

  // ---------------- routine overlay legend (auto mode, bottom-left) ----------------
  function RoutineLegend({ run, time, running }) {
    const items = [
      { c: 'var(--accent)', t: 'Selected / active' },
      { c: '#f6a93a', t: 'Generated \u00b7 runtime', dash: true },
      { c: '#5b636e', t: 'Completed' },
      { c: '#474e59', t: 'Pending', dash: true },
    ];
    let idx = -1;
    for (let i = 0; i < run.steps.length; i++) { const s = run.steps[i]; if (time >= s.t0 && time < s.t1 + 1e-6) { idx = i; break; } idx = i; }
    const cur = idx >= 0 ? run.steps[idx] : null;
    return h('div', { className: 'rlegend' },
      h('div', { className: 'rlegend-h' }, 'Routine \u00b7 field overlay'),
      h('div', { className: 'rlegend-grid' }, items.map((it, i) =>
        h('div', { key: i, className: 'rlegend-row' },
          h('span', { className: 'rlegend-bar' + (it.dash ? ' dash' : ''), style: { background: it.dash ? 'none' : it.c, borderColor: it.c } }),
          h('span', { className: 'rlegend-t' }, it.t)))),
      cur && h('div', { className: 'rlegend-now' },
        h('span', { className: 'rlegend-dot', style: { background: running ? 'var(--good)' : 'var(--txt-3)' } }),
        running ? 'Executing' : 'Staged', h('span', { className: 'rlegend-nowt' }, fmt(time) + ' / ' + fmt(run.total))));
  }

  window.Panels = { Toolbar, ToolRail, ConstraintBar, Outline, Overlay, Diagnostics, Transport, ViewControls, RoutineLegend };
})();
