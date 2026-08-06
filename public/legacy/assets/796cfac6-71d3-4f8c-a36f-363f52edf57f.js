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
        h('button', { type: 'button', onClick: () => beginEdit('path', path.id, path.name) }, h(Icon, { name: 'edit', size: 13 }), h('span', null, 'Rename')),
        h('button', { type: 'button', onClick: () => { dupPath(index); setMenu(null); } }, h(Icon, { name: 'copy', size: 13 }), h('span', null, 'Duplicate')),
        h('button', { className: 'danger', type: 'button', disabled: project.paths.length <= 1, onClick: () => { if (delPath(index)) setMenu(null); } }, h(Icon, { name: 'trash', size: 13 }), h('span', null, 'Delete'))),
      h('label', { className: 'pathlib-move' }, h(Icon, { name: 'folder', size: 14 }), h('span', null, 'Move to'),
        h('select', { 'aria-label': 'Move ' + path.name + ' to folder', value: path.folderId || '', onChange: (e) => { movePathToFolder(index, e.target.value); setMenu(null); } },
          h('option', { value: '' }, 'Unfiled'), folders.map((folder) => h('option', { key: folder.id, value: folder.id }, folder.name)))));
    const pathRow = (path, index, showFolder) => editing && editing.kind === 'path' && editing.id === path.id
      ? h('div', { key: path.id, className: 'pathlib-editrow' }, editForm())
      : h('div', { key: path.id, className: 'pathlib-item' },
          h('div', { className: 'pathlib-path' + (index === activeIdx ? ' on' : '') },
            h('button', { type: 'button', className: 'pathlib-pick', 'aria-current': index === activeIdx ? 'true' : undefined, onClick: () => { setMenu(null); setActive(index); } },
              h(Icon, { name: index === activeIdx ? 'check' : 'route', size: 14 }),
              h('span', { className: 'pathlib-copy' },
                h('span', { className: 'pathlib-name' }, path.name),
                showFolder && h('span', { className: 'pathlib-foldername' }, folderName(path.folderId))),
              h('span', { className: 'pathlib-time' }, times[path.id] == null ? '\u2014' : times[path.id].toFixed(2) + 's')),
            h('button', { className: 'pathlib-more', type: 'button', title: 'Path actions', 'aria-label': 'Actions for ' + path.name, 'aria-controls': 'path-actions-' + path.id, 'aria-expanded': !!(menu && menu.kind === 'path' && menu.id === path.id), onClick: () => setMenu((current) => current && current.kind === 'path' && current.id === path.id ? null : { kind: 'path', id: path.id }) }, '\u2026')),
          menu && menu.kind === 'path' && menu.id === path.id && pathActions(path, index));
    const group = (folder) => {
      const id = folder ? folder.id : '', label = folder ? folder.name : 'Unfiled';
      const members = project.paths.map((path, index) => ({ path, index })).filter((row) => (row.path.folderId || '') === id);
      if (!folder && !members.length) return null;
      const key = id || '_unfiled', shut = !!collapsed[key];
      return h('section', { key, className: 'pathlib-group' },
        editing && editing.kind === 'folder' && editing.id === id ? editForm() : h('div', { className: 'pathlib-folderwrap' },
          h('div', { className: 'pathlib-folder' },
            h('button', { type: 'button', className: 'pathlib-foldertoggle', 'aria-expanded': !shut, onClick: () => setCollapsed((state) => ({ ...state, [key]: !shut })) }, h(Icon, { name: 'chevron', size: 13 }), h('span', null, label), h('small', null, members.length)),
            folder && h('button', { className: 'pathlib-more', type: 'button', title: 'Folder actions', 'aria-label': 'Actions for folder ' + label, 'aria-controls': 'folder-actions-' + id, 'aria-expanded': !!(menu && menu.kind === 'folder' && menu.id === id), onClick: () => setMenu((current) => current && current.kind === 'folder' && current.id === id ? null : { kind: 'folder', id }) }, '\u2026')),
          folder && menu && menu.kind === 'folder' && menu.id === id && h('div', { id: 'folder-actions-' + id, className: 'pathlib-actionmenu', role: 'group', 'aria-label': label + ' folder actions' },
            h('div', { className: 'pathlib-actionrow' },
              h('button', { type: 'button', 'aria-label': 'New path in ' + label, onClick: () => { addPath(id); setMenu(null); } }, h(Icon, { name: 'plus', size: 13 }), h('span', null, 'New path')),
              h('button', { type: 'button', 'aria-label': 'Rename folder ' + label, onClick: () => beginEdit('folder', id, label) }, h(Icon, { name: 'edit', size: 13 }), h('span', null, 'Rename')),
              h('button', { className: 'danger', type: 'button', 'aria-label': 'Delete folder ' + label, onClick: () => { if (deletePathFolder(id)) setMenu(null); } }, h(Icon, { name: 'trash', size: 13 }), h('span', null, 'Delete'))))),
        !shut && h('div', { className: 'pathlib-children' }, members.length ? members.map((row) => pathRow(row.path, row.index, false)) : h('div', { className: 'pathlib-empty' }, 'No paths')));
    };
    const needle = query.trim().toLowerCase();
    const results = project.paths.map((path, index) => ({ path, index })).filter((row) => (row.path.name + ' ' + folderName(row.path.folderId)).toLowerCase().includes(needle));
    return h('div', { className: 'pathsw pathlib' },
      h('button', { ref: triggerRef, className: 'pathsw-btn' + (open ? ' open' : ''), type: 'button', title: cur ? cur.name : 'No path', 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => open ? close() : setOpen(true) },
        h('span', { className: 'pathsw-ic' }, h(Icon, { name: 'route', size: 15 })), h('span', { className: 'pathsw-nm' }, cur ? cur.name : 'No path'), h('span', { className: 'pathsw-t' }, (cur && times[cur.id] != null ? times[cur.id].toFixed(2) : '--') + 's'), h(Icon, { name: 'chevron', size: 14 })),
      open && h(React.Fragment, null,
        h('button', { className: 'pathlib-scrim', type: 'button', tabIndex: -1, 'aria-label': 'Close path library', onClick: close }),
        h('aside', { ref: panelRef, className: 'pathlib-panel', role: 'dialog', 'aria-modal': true, 'aria-label': 'Path library', tabIndex: -1, onKeyDown: trapFocus },
          h('div', { className: 'pathlib-head' }, h('div', null, h(Icon, { name: 'folder', size: 15 }), h('strong', null, 'Path library'), h('span', null, project.paths.length)), h('button', { type: 'button', 'aria-label': 'Close path library', onClick: close }, h(Icon, { name: 'x', size: 15 }))),
          h('div', { className: 'pathlib-create' }, h('button', { className: 'primary', type: 'button', onClick: () => addPath() }, h(Icon, { name: 'plus', size: 14 }), 'New path'), h('button', { type: 'button', onClick: () => { const folder = addPathFolder(); if (folder) beginEdit('folder', folder.id, folder.name); } }, h(Icon, { name: 'folder', size: 14 }), 'New folder')),
          h('label', { className: 'sr-only', htmlFor: 'path-library-search' }, 'Search paths and folders'),
          h('div', { className: 'pathlib-searchwrap' }, h(Icon, { name: 'search', size: 14 }), h('input', { id: 'path-library-search', ref: searchRef, className: 'pathlib-search', type: 'search', 'aria-label': 'Search paths and folders', autoComplete: 'off', spellCheck: false, placeholder: 'Search paths and folders', value: query, onChange: (e) => { setMenu(null); setQuery(e.target.value); } })),
          h('div', { className: 'pathlib-scroll' }, needle ? (results.length ? results.map((row) => pathRow(row.path, row.index, true)) : h('div', { className: 'pathlib-empty pathlib-emptysearch' }, h('strong', null, 'No matching paths'), h('span', null, 'Try a different name or folder.'))) : [folders.map(group), group(null)]))));
  }

  function PlannerControl({ plannerId, setPlannerId }) {
    const lastNative = useRef('profiledSpline'), lastLabview = useRef('labviewBezier');
    const labview = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
    useEffect(() => { if (labview) lastLabview.current = plannerId; else lastNative.current = plannerId; }, [labview, plannerId]);
    const methods = labview
      ? [
          { v: 'labviewBezier', label: 'Bezier', title: 'LabVIEW Bezier compatibility planner' },
          { v: 'labviewClothoid', label: 'Clothoid', title: 'LabVIEW clothoid compatibility planner' },
        ]
      : [
          { v: 'profiledSpline', label: 'Profiled', title: 'Profiled spline planner' },
          { v: 'optimizedTrajectory', label: 'Optimized', title: 'Optimized trajectory (experimental)' },
        ];
    return h('div', { className: 'plannercontrol', title: 'Geometry and timing planner' },
      h(Seg, { className: 'planner-family', value: labview ? 'labview' : 'native', ariaLabel: 'Planner family', options: [{ v: 'native', label: 'Java' }, { v: 'labview', label: 'LabVIEW' }], onChange: (value) => setPlannerId(value === 'labview' ? lastLabview.current : lastNative.current) }),
      h(Seg, { className: 'planner-method', value: plannerId, ariaLabel: 'Trajectory planner', options: methods, onChange: setPlannerId }));
  }

  // ---------------- top bar ----------------
  function Toolbar(props) {
    const { project, page, setPage, alliance, setAlliance,
      onUndo, onRedo, onExport, onExportJava, javaProject, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times, plannerId, setPlannerId } = props;
    const plan = page === 'plan';
    const javaReady = !!(javaProject && javaProject.catalog && javaProject.catalog.authoritative && javaProject.integration && javaProject.integration.installed && javaProject.integration.supportVersion === javaProject.catalog.supportVersion);
    return h('header', { className: 'toolbar' },
      h('div', { className: 'tb-left' },
        h('div', { className: 'brand' }, h('img', { className: 'brand-mark', src: 'assets/wrlp-chap-bird-original.svg', alt: '' }), h('span', { className: 'brand-name' }, 'Bordeaux')),
        h('nav', { className: 'pageswitch', 'aria-label': 'Workspace' },
          h('button', { className: plan ? 'on' : '', type: 'button', 'aria-current': plan ? 'page' : undefined, onClick: () => setPage('plan') }, h(Icon, { name: 'route', size: 15 }), 'Plan'),
          h('button', { className: page === 'auto' ? 'on' : '', type: 'button', 'aria-current': page === 'auto' ? 'page' : undefined, onClick: () => setPage('auto') }, h(Icon, { name: 'layers', size: 15 }), 'Auto'),
          h('button', { className: page === 'robot' ? 'on' : '', type: 'button', 'aria-current': page === 'robot' ? 'page' : undefined, onClick: () => setPage('robot') }, h(Icon, { name: 'car', size: 15 }), 'Robot')),
        plan && h(PathLibrary, { project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times })),

      h('div', { className: 'tb-right' },
        h('button', { className: 'qbtn tb-file', type: 'button', title: 'Open project', 'aria-label': 'Open project', onClick: props.onOpen }, 'Open'),
        h('button', { className: 'qbtn tb-file', type: 'button', title: 'Save project (⌘S)', 'aria-label': 'Save project', onClick: () => props.onSave(false) }, 'Save'),
        plan && h(React.Fragment, null,
          h(IconBtn, { icon: 'undo', onClick: onUndo, title: 'Undo  (\u2318Z)' }),
          h(IconBtn, { icon: 'redo', onClick: onRedo, title: 'Redo  (\u21e7\u2318Z)' }),
          h('div', { className: 'tbdiv' }),
          h(PlannerControl, { plannerId, setPlannerId })),
        (plan || page === 'auto') && h(React.Fragment, null,
          h('button', { className: 'alliance ' + alliance, type: 'button', 'aria-pressed': alliance === 'red', onClick: () => setAlliance(alliance === 'blue' ? 'red' : 'blue'), title: 'Flip alliance' },
            h('span', { className: 'alliance-dot' }), alliance === 'blue' ? 'Blue' : 'Red')),
        (plan || page === 'auto') && h(React.Fragment, null,
          h('button', { className: 'exportbtn exportjava' + (javaReady ? ' ready' : ''), type: 'button', disabled: !javaReady || !!(javaProject && javaProject.operation), title: javaReady ? 'Export native Java trajectory JSON to the linked robot project' : 'Link a Java project, install support, and build its annotated command catalog first', 'aria-label': javaReady ? 'Export Java trajectory' : 'Java trajectory export unavailable until Java support is ready', onClick: onExportJava }, h(Icon, { name: 'share', size: 15 }), javaProject && javaProject.operation === 'export' ? 'Exporting…' : 'Java JSON'),
          h('button', { className: 'exportbtn', type: 'button', title: 'Export .bdx', 'aria-label': 'Export .bdx', onClick: onExport }, h(Icon, { name: 'share', size: 15 }), 'Export .bdx'))));
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
      h('button', { key: t.id, className: 'toolrail-b' + (tool === t.id ? ' on' : ''), type: 'button', 'aria-label': t.label, 'aria-pressed': tool === t.id, title: t.label + '  (' + t.key + ')', onClick: () => setTool(t.id) },
        h(Icon, { name: t.icon, size: 18 }), h('span', { className: 'toolrail-k' }, t.key))));
  }

  // ---------------- global-constraint chip bar (top of canvas) — memo §6 ----------------
  function ConstraintBar({ c, robot, onOpen }) {
    const chips = [
      { k: 'Max V', v: Math.min(c.maxVel, robot.maxSpeed).toFixed(1), u: 'm/s' },
      { k: 'Max A', v: c.maxAccel.toFixed(1), u: 'm/s\u00b2' },
      { k: 'Decel', v: (c.maxDecel != null ? c.maxDecel : c.maxAccel).toFixed(1), u: 'm/s\u00b2' },
      { k: 'Max \u03c9', v: (c.maxAngVel || 0).toFixed(0), u: '\u00b0/s' },
    ];
    return h('button', { className: 'cbar', type: 'button', title: 'Edit global constraints in the inspector', onClick: onOpen },
      h('span', { className: 'cbar-ic' }, h(Icon, { name: 'gauge', size: 14 })),
      chips.map((ch, i) => h('span', { key: i, className: 'cbar-chip' },
        h('span', { className: 'cbar-k' }, ch.k),
        h('span', { className: 'cbar-v' }, ch.v),
        h('span', { className: 'cbar-u' }, ch.u))),
      h('span', { className: 'cbar-edit' }, 'Edit'));
  }

  // ---------------- outline: document STRUCTURE only (memo §5 / §7) ----------------
  const behPill = (w) => w.stop ? { t: w.wait ? 'stop ' + (w.wait) + 's' : 'stop', c: 'r' } : w.corner ? { t: 'corner', c: 'n' } : null;
  const inspectItem = (actions, kind, index, event) => {
    event.preventDefault(); event.stopPropagation();
    actions.select(kind, index);
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
