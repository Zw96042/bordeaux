// Bordeaux — chrome: top bar, path switcher, tool rail, outline, constraint chip bar,
// metric overlay, path-check drawer, telemetry/transport, view controls.
// Needs React + window.UI + window.PM. Exports window.Panels
(function () {
  const { useRef, useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { Icon, IconBtn, Dropdown, Section, Num, Seg, constraintRangeSummary } = window.UI;
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
      h('div', { className: 'pathlib-move' }, h(Icon, { name: 'folder', size: 14 }), h('span', null, 'Move to'),
        h(Dropdown, { id: 'move-path-' + path.id, ariaLabel: 'Move ' + path.name + ' to folder', compact: true,
          className: 'pathlib-folder-dropdown', value: path.folderId || '',
          items: [{ value: '', label: 'Unfiled' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))],
          onChange: (value) => { movePathToFolder(index, value); setMenu(null); } })));
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

  // ---------------- top bar ----------------
  function PlannerFamily({ plannerId, onChange }) {
    const value = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid' ? 'labview' : 'java';
    return h(Seg, { className: 'planner-family', value, ariaLabel: 'Trajectory format', options: [
      { v: 'java', label: 'Java' },
      { v: 'labview', label: 'LabVIEW' },
    ], onChange });
  }

  function Toolbar(props) {
    const { project, page, setPage, alliance, setAlliance,
      onUndo, onRedo, onExport, onExportJava, javaProject, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times, plannerId, setPlannerFamily } = props;
    const plan = page === 'plan';
    const labview = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
    const javaReady = !!(javaProject && javaProject.catalog && javaProject.catalog.authoritative && javaProject.integration && javaProject.integration.installed && javaProject.integration.supportVersion === javaProject.catalog.supportVersion);
    return h('header', { className: 'toolbar' },
      h('div', { className: 'tb-left' },
        h('div', { className: 'brand' }, h('img', { className: 'brand-mark', src: 'assets/wrlp-chap-bird-original.svg', alt: '' }), h('span', { className: 'brand-name' }, 'Bordeaux')),
        h('nav', { className: 'pageswitch', 'aria-label': 'Workspace' },
          h('button', { className: plan ? 'on' : '', type: 'button', 'aria-current': plan ? 'page' : undefined, onClick: () => setPage('plan') }, h(Icon, { name: 'route', size: 15 }), 'Plan'),
          h('button', { className: page === 'auto' ? 'on' : '', type: 'button', 'aria-current': page === 'auto' ? 'page' : undefined, onClick: () => setPage('auto') }, h(Icon, { name: 'layers', size: 15 }), 'Acquatine'),
          h('button', { className: page === 'robot' ? 'on' : '', type: 'button', 'aria-current': page === 'robot' ? 'page' : undefined, onClick: () => setPage('robot') }, h(Icon, { name: 'car', size: 15 }), 'Robot')),
        plan && h(PathLibrary, { project, activeIdx, setActive, addPath, dupPath, delPath, renamePath, addPathFolder, renamePathFolder, deletePathFolder, movePathToFolder, times })),

      h('div', { className: 'tb-right' },
        plan && h(React.Fragment, null,
          h('button', { className: 'qbtn tb-file', type: 'button', title: 'Open project', 'aria-label': 'Open project', onClick: props.onOpen }, 'Open'),
          h('button', { className: 'qbtn tb-file', type: 'button', title: 'Save project (⌘S)', 'aria-label': 'Save project', onClick: () => props.onSave(false) }, 'Save')),
        (plan || page === 'auto') && h(React.Fragment, null,
          h(IconBtn, { icon: 'undo', onClick: onUndo, title: 'Undo  (\u2318Z)' }),
          h(IconBtn, { icon: 'redo', onClick: onRedo, title: 'Redo  (\u21e7\u2318Z)' })),
        plan && h(React.Fragment, null,
          h('div', { className: 'tbdiv' }),
          h(PlannerFamily, { plannerId, onChange: setPlannerFamily })),
        (plan || page === 'auto') && h(React.Fragment, null,
          h('button', { className: 'alliance', type: 'button', onClick: () => setAlliance(alliance === 'blue' ? 'red' : 'blue'), title: 'Switch to ' + (alliance === 'blue' ? 'red' : 'blue') + ' alliance', 'aria-label': 'Alliance view: ' + alliance + '. Switch to ' + (alliance === 'blue' ? 'red' : 'blue') },
            h('span', { className: 'alliance-side blue' + (alliance === 'blue' ? ' on' : '') }, 'B'),
            h('span', { className: 'alliance-side red' + (alliance === 'red' ? ' on' : '') }, 'R'))),
        plan && h(React.Fragment, null,
          labview
            ? h('button', { className: 'exportbtn', type: 'button', title: 'Export the selected path as .bdx', 'aria-label': 'Export .bdx', onClick: onExport }, h(Icon, { name: 'share', size: 15 }), 'Export .bdx')
            : h('button', { className: 'exportbtn exportjava' + (javaReady ? ' ready' : ''), type: 'button', disabled: !javaReady || !!(javaProject && javaProject.operation), title: javaReady ? 'Export Java trajectory JSON to the linked robot project' : 'Link a Java project, install support, and build its command catalog first', 'aria-label': javaReady ? 'Export Java JSON' : 'Java JSON export unavailable until Java support is ready', onClick: onExportJava }, h(Icon, { name: 'share', size: 15 }), javaProject && javaProject.operation === 'export' ? 'Exporting…' : 'Export JSON'))));
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
    if (actions.openInspector) actions.openInspector();
  };

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
      const cls = 'featrow wpfeatrow' + (sel.kind === 'wp' && sel.idx === i ? ' sel' : '') + (drag && drag.from === i ? ' dragging' : '') + (drag && drag.over === i && drag.from !== i ? ' over' : '');
      return h('div', { key: i, ref: (el) => (rows.current[i] = el), className: cls },
        h('button', { className: 'featgrip', type: 'button', 'aria-label': 'Drag ' + label + ' to reorder', title: 'Drag to reorder', onPointerDown: startDrag(i) }, h(Icon, { name: 'drag', size: 13 })),
        h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'wp' && sel.idx === i, onClick: (e) => { if (e.shiftKey && wps.length > 2) actions.delWp(i); else actions.select('wp', i); }, onDoubleClick: (e) => inspectItem(actions, 'wp', i, e) },
          h('span', { className: 'featdot ' + (w.stop ? 'r sq' : i === 0 ? 'g' : i === wps.length - 1 ? 'r' : 'b') }),
          h('span', { className: 'featnm', title: label }, label),
          mid && w.thetaOn && h('span', { className: 'pill th' }, (w.theta || 0).toFixed(0) + '\u00b0'),
          bp ? h('span', { className: 'pill ' + bp.c }, bp.t) : h('span', { className: 'featmeta' }, w.x.toFixed(1) + ', ' + w.y.toFixed(1))),
        i > 0 && h('button', { className: 'featmove', type: 'button', 'aria-label': 'Move ' + label + ' up', onClick: () => actions.reorderWp(i, i - 1) }, '\u2191'),
        i < wps.length - 1 && h('button', { className: 'featmove', type: 'button', 'aria-label': 'Move ' + label + ' down', onClick: () => actions.reorderWp(i, i + 1) }, '\u2193'),
        wps.length > 2 && h('button', { className: 'featdel', 'aria-label': 'Delete ' + label, title: 'Delete', onClick: () => actions.delWp(i) }, h(Icon, { name: 'trash', size: 12 })));
    }));
  }

  function SegmentList({ wps, sel, actions }) {
    if (wps.length < 2) return h('div', { className: 'featempty' }, 'Add a second waypoint to form a segment');
    const name = (k) => k === 0 ? 'Start' : k === wps.length - 1 ? 'End' : 'Waypoint ' + k;
    const typeName = (id) => (window.PM.SEGTYPES.find((s) => s.id === id) || window.PM.SEGTYPES[2]).label;
    return h(React.Fragment, null, wps.slice(0, -1).map((w, i) =>
      h('div', { key: i, className: 'featrow segfeatrow' + (sel.kind === 'seg' && sel.idx === i ? ' sel' : '') },
        h('span', { className: 'featindent', 'aria-hidden': true }),
        h('button', { type: 'button', className: 'featselect', 'aria-pressed': sel.kind === 'seg' && sel.idx === i, onClick: () => actions.select('seg', i), onDoubleClick: (e) => inspectItem(actions, 'seg', i, e) },
          h('span', { className: 'featdot b' }),
          h('span', { className: 'featnm', title: name(i) + ' \u2192 ' + name(i + 1) }, name(i) + ' \u2192 ' + name(i + 1)),
          h('span', { className: 'featmeta' }, typeName(w.segType))))));
  }

  function Outline({ open, setOpen, doc, derived, sel, actions, secOpen, setSecOpen, robot }) {
    const tog = (k) => setSecOpen((o) => ({ ...o, [k]: !o[k] }));
    const wps = doc.waypoints;
    if (!open) {
      return h('button', { className: 'outline-tab', type: 'button', title: 'Show outline', onClick: () => setOpen(true) },
        h(Icon, { name: 'zones', size: 16 }), h('span', null, 'Outline'));
    }
    return h('div', { className: 'outline' },
      h('div', { className: 'outline-hd' },
        h('span', { className: 'outline-t' }, 'Outline'),
        h('button', { className: 'mini', type: 'button', title: 'Hide outline', 'aria-label': 'Hide outline', onClick: () => setOpen(false) }, h('span', { className: 'rot90' }, h(Icon, { name: 'chevron', size: 15 })))),
      h('div', { className: 'outline-scroll' },
        h(Section, { icon: 'waypoint', title: 'Waypoints', count: wps.length, open: secOpen.wp, onToggle: () => tog('wp'),
          right: h('button', { className: 'mini', type: 'button', title: 'Place waypoint', 'aria-label': 'Place waypoint', onClick: (e) => { e.stopPropagation(); actions.select(null, -1); actions.setTool('waypoint'); } }, h(Icon, { name: 'plus', size: 13 })) },
          h(WaypointList, { wps, sel, actions })),
        h(Section, { icon: 'route', title: 'Segments', count: Math.max(0, wps.length - 1), open: !!secOpen.sg, onToggle: () => tog('sg') },
          h(SegmentList, { wps, sel, actions })),
        h(Section, { icon: 'rotation', title: 'Rotation Targets', count: doc.targets.length, open: secOpen.rt, onToggle: () => tog('rt'),
          right: h('button', { className: 'mini', type: 'button', title: 'Add rotation target', 'aria-label': 'Add rotation target', onClick: (e) => { e.stopPropagation(); actions.addTargetMid(); } }, h(Icon, { name: 'plus', size: 13 })) },
          doc.targets.length === 0 ? h('div', { className: 'featempty' }, 'Press R, then click the path') :
            doc.targets.map((t, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'rt' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'rt' && sel.idx === i, onClick: () => actions.select('rt', i), onDoubleClick: (e) => inspectItem(actions, 'rt', i, e) }, h('span', { className: 'featdot n' }), h('span', { className: 'featnm' }, t.deg.toFixed(0) + '\u00b0'), h('span', { className: 'featmeta' }, t.anchor === 'dist' ? (t.d != null ? t.d : window.PM.featureFraction(t, derived.sample) * derived.sample.length).toFixed(1) + ' m' : (window.PM.featureFraction(t, derived.sample) * 100).toFixed(0) + '%')),
              h('button', { className: 'featdel', 'aria-label': 'Delete rotation target', title: 'Delete', onClick: () => actions.delTarget(i) }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'flag2', title: 'Event Markers', count: doc.markers.length, open: secOpen.em, onToggle: () => tog('em'),
          right: h('button', { className: 'mini', type: 'button', title: 'Add event marker', 'aria-label': 'Add event marker', onClick: (e) => { e.stopPropagation(); actions.addMarkerMid(); } }, h(Icon, { name: 'plus', size: 13 })) },
          doc.markers.length === 0 ? h('div', { className: 'featempty' }, 'Press M, then click the path') :
            doc.markers.map((m, i) => h('div', { key: i, className: 'featrow' + (sel.kind === 'em' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-pressed': sel.kind === 'em' && sel.idx === i, onClick: () => actions.select('em', i), onDoubleClick: (e) => inspectItem(actions, 'em', i, e) }, h('span', { className: 'featdot n' }), h('span', { className: 'featnm', title: m.name }, m.name), h('span', { className: 'featmeta' }, m.anchor === 'dist' ? (m.d != null ? m.d : window.PM.featureFraction(m, derived.sample) * derived.sample.length).toFixed(1) + ' m' : (window.PM.featureFraction(m, derived.sample) * 100).toFixed(0) + '%')),
              h('button', { className: 'featdel', 'aria-label': 'Delete event marker ' + m.name, title: 'Delete', onClick: () => actions.delMarker(i) }, h(Icon, { name: 'trash', size: 12 }))))),
        h(Section, { icon: 'gauge', title: 'Constraint Ranges', count: (doc.ranges || []).length, open: secOpen.cr !== false, onToggle: () => tog('cr'),
          right: h('button', { className: 'mini', type: 'button', title: 'Add constraint range', 'aria-label': 'Add constraint range', onClick: (e) => { e.stopPropagation(); actions.addRangeMid(); } }, h(Icon, { name: 'plus', size: 13 })) },
          (doc.ranges || []).length === 0 ? h('div', { className: 'featempty' }, 'Press C, then drag the path') :
            doc.ranges.map((rg, i) => { const effective = (derived.effRanges && derived.effRanges[i]) || rg; const summary = constraintRangeSummary(rg, doc.constraints, robot); const rangeLabel = summary ? summary.text : (rg.name || 'Constraint range'); const rangeMeta = rg.anchor === 'dist' ? (Math.min(effective.f0, effective.f1) * derived.sample.length).toFixed(1) + '\u2013' + (Math.max(effective.f0, effective.f1) * derived.sample.length).toFixed(1) + ' m' : rg.anchor === 'wp' && rg.t0 != null && rg.t1 != null ? 'S' + ((rg.w0 || 0) + 1) + ' ' + Math.round(rg.t0 * 100) + '% \u2013 S' + ((rg.w1 || 0) + 1) + ' ' + Math.round(rg.t1 * 100) + '%' : rg.anchor === 'wp' ? 'Waypoint ' + Math.min(rg.w0 || 0, rg.w1 || 0) + '\u2013' + Math.max(rg.w0 || 0, rg.w1 || 0) : (Math.min(effective.f0, effective.f1) * 100).toFixed(0) + '\u2013' + (Math.max(effective.f0, effective.f1) * 100).toFixed(0) + '%'; return h('div', { key: i, className: 'featrow' + (sel.kind === 'cr' && sel.idx === i ? ' sel' : '') },
              h('button', { className: 'featselect', type: 'button', 'aria-label': 'Constraint range, ' + (summary ? summary.ariaLabel : rangeLabel) + ', ' + rangeMeta, 'aria-pressed': sel.kind === 'cr' && sel.idx === i, onClick: () => actions.select('cr', i), onDoubleClick: (e) => inspectItem(actions, 'cr', i, e) }, h('span', { className: 'featdot w' }), h('span', { className: 'featnm' }, rangeLabel), h('span', { className: 'featmeta' }, rangeMeta)),
              h('button', { className: 'featdel', 'aria-label': 'Delete constraint range', title: 'Delete', onClick: () => actions.delRange(i) }, h(Icon, { name: 'trash', size: 12 }))); }))));
  }

  // ---------------- compact metric control for the timeline toolbar ----------------
  function MetricControl({ metric, setMetric, derived, diagOpen, onToggleDiag, plannerId }) {
    const M = derived.metrics || {};
    const checks = derived.checks || [];
    const issues = checks.filter((check) => check.level !== 'note');
    const notes = checks.filter((check) => check.level === 'note');
    const grad = window.PM.metricGradient(metric);
    const def = (window.PM.METRICS || []).find((m) => m.id === metric) || {};
    let lo = '0', hi = '0';
    if (metric === 'velocity') { lo = '0'; hi = (M.vMax || 0).toFixed(1); }
    else if (metric === 'accel') { const a = (M.aMax || 0).toFixed(1); lo = '-' + a; hi = '+' + a; }
    else if (metric === 'angvel') { const w = ((M.wMax || 0) * R2D).toFixed(0); lo = '-' + w; hi = '+' + w; }
    else { lo = '0'; hi = (M.kMax || 0).toFixed(2); }
    const errors = issues.filter((check) => check.level === 'error').length;
    return h('div', { className: 'metricctl' },
      (plannerId === 'labviewBezier' || plannerId === 'labviewClothoid') && h('span', { className: 'ovapprox', title: 'The canvas mirrors the compatibility math; exported samples remain authoritative.' }, '\u2248'),
      h(Dropdown, { id: 'field-overlay-metric', ariaLabel: 'Field overlay metric', compact: true,
        className: 'metric-dropdown', value: metric,
        items: (window.PM.METRICS || []).map((m) => ({ value: m.id, label: m.label, meta: m.unit || '' })),
        onChange: setMetric }),
      h('span', { className: 'metric-swatch', style: { background: grad }, 'aria-hidden': true }),
      h('span', { className: 'metric-range', 'aria-hidden': true }, lo + '\u2013' + hi + ' ' + (def.unit || '')),
      checks.length > 0 && h('button', { className: 'ovsafety ' + (issues.length ? (errors ? 'bad' : 'warn') : 'note') + (diagOpen ? ' open' : ''), type: 'button', onClick: onToggleDiag, title: 'Open path checks' },
          h('span', { className: 'ovsafety-dot' }),
          h('span', null, issues.length
            ? issues.length + (issues.length > 1 ? ' issues' : ' issue')
            : notes.length + (notes.length > 1 ? ' notes' : ' note'))));
  }

  // ---------------- path checks drawer ----------------
  function PathChecks({ derived, doc, onClose, onPick }) {
    const checks = derived.checks || [];
    const issueCount = checks.filter((check) => check.level !== 'note').length;
    const n = doc.waypoints.length;
    const segName = (s) => (s === 0 ? 'Start' : 'WP' + s) + ' \u2192 ' + (s + 1 === n - 1 ? 'End' : 'WP' + (s + 1));
    return h('div', { className: 'diag' },
      h('div', { className: 'diag-hd' },
        h('span', { className: 'diag-t' }, 'Path checks'),
        h('span', { className: 'diag-c' }, issueCount ? issueCount : checks.length),
        h('button', { className: 'ctxinsp-x', type: 'button', title: 'Close', 'aria-label': 'Close path checks', onClick: onClose }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'diag-scroll' },
        checks.length === 0
          ? h('div', { className: 'diag-empty' }, h(Icon, { name: 'check', size: 16 }), 'No constraint violations detected.')
          : checks.map((check, i) => h('div', { key: i, className: 'diag-row ' + check.level },
              h('button', { className: 'diag-main', type: 'button', onClick: () => onPick(check) },
                h('span', { className: 'diag-sev ' + check.level }),
                h('div', { className: 'diag-body' },
                  h('div', { className: 'diag-txt' }, check.text),
                  h('div', { className: 'diag-loc' }, (check.level === 'note' ? 'Performance note \u00b7 ' : 'Constraint check \u00b7 ') + segName(check.seg))),
                h('span', { className: 'diag-pin' }, h(Icon, { name: 'pin', size: 13 })))))));
  }

  // ---------------- telemetry graph + transport ----------------
  function Transport({ derived, doc, metric, setMetric, playTime, playing, togglePlayback, seek, restart, graphOpen, setGraphOpen, diagOpen, onToggleDiag, plannerId }) {
    const total = derived.prof.totalTime || 0.001;
    const pct = Math.max(0, Math.min(1, playTime / total));
    const scrubStep = Math.min(0.02, total);
    const graphRef = useRef(null);
    const prof = derived.prof, pts = derived.sample.pts, M = derived.metrics;
    const timeline = useMemo(() => {
      const motionEnd = Math.max(0, Number(prof.t && prof.t[prof.t.length - 1]) || 0);
      const distance = pts.length ? Math.max(0, Number(pts[pts.length - 1].s) || 0) : 0;
      const timeAtFraction = (fraction) => {
        const f = Math.max(0, Math.min(1, Number(fraction) || 0));
        if (pts.length < 2 || !prof.t || prof.t.length < 2 || distance <= 1e-9) return f * motionEnd;
        const target = f * distance;
        if (target <= 0) return 0;
        if (target >= distance) return motionEnd;
        let low = 1, high = pts.length - 1;
        while (low < high) { const middle = (low + high) >> 1; if (pts[middle].s < target) low = middle + 1; else high = middle; }
        const before = pts[low - 1], after = pts[low];
        const part = (target - before.s) / Math.max(1e-9, after.s - before.s);
        return prof.t[low - 1] + (prof.t[low] - prof.t[low - 1]) * part;
      };
      const percentAt = (fraction) => Math.max(0, Math.min(100, timeAtFraction(fraction) / total * 100));
      const markers = ((doc && doc.markers) || []).map((marker, index) => ({
        key: 'event-' + index,
        label: marker.name || 'Event marker ' + (index + 1),
        left: percentAt(window.PM.featureFraction(marker, derived.sample)),
      }));
      const targets = ((doc && doc.targets) || []).map((target, index) => ({
        key: 'target-' + index,
        label: 'Rotation target ' + (index + 1) + ' · ' + Number(target.deg || 0).toFixed(0) + '°',
        left: percentAt(window.PM.featureFraction(target, derived.sample)),
      }));
      const ranges = (derived.effRanges || []).map((range, index) => {
        const start = percentAt(range.f0), end = percentAt(range.f1);
        return { key: 'range-' + index, label: range.name || 'Constraint range ' + (index + 1), left: Math.min(start, end), width: Math.abs(end - start) };
      });
      const waypoints = (derived.wpFrac || []).slice(1, -1).map((fraction, index) => ({
        key: 'waypoint-' + index,
        label: 'Waypoint ' + (index + 2) + (((doc && doc.waypoints && doc.waypoints[index + 1] || {}).stop) ? ' · stop' : ''),
        left: percentAt(fraction),
        stop: !!(doc && doc.waypoints && doc.waypoints[index + 1] && doc.waypoints[index + 1].stop),
      }));
      return { markers, targets, ranges, waypoints };
    }, [derived, doc, prof, pts, total]);
    const featureCount = timeline.markers.length + timeline.targets.length + timeline.ranges.length;
    const featureSummary = [
      timeline.markers.length ? timeline.markers.length + (timeline.markers.length === 1 ? ' event' : ' events') : '',
      timeline.targets.length ? timeline.targets.length + (timeline.targets.length === 1 ? ' target' : ' targets') : '',
      timeline.ranges.length ? timeline.ranges.length + (timeline.ranges.length === 1 ? ' range' : ' ranges') : '',
    ].filter(Boolean).join(' · ');
    const timelineTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
      fraction,
      label: (total * fraction).toFixed(total < 10 ? 2 : 1) + 's',
    }));

    let arr = M.v, vmin = 0, vmax = M.vMax || 1, signed = false, unit = 'm/s', title = 'Velocity';
    if (metric === 'accel') { arr = M.accel; vmax = M.aMax || 1; vmin = -vmax; signed = true; unit = 'm/s\u00b2'; title = 'Acceleration'; }
    else if (metric === 'angvel') { arr = (M.omega || []).map((o) => o * R2D); vmax = (M.wMax || 0.01) * R2D; vmin = -vmax; signed = true; unit = '\u00b0/s'; title = 'Angular velocity'; }
    else if (metric === 'curvature') { arr = M.curv; vmin = 0; vmax = M.kMax || 0.01; unit = '1/m'; title = 'Curvature'; }

    const jigglePeak = metric === 'velocity' && prof.jiggles
      ? prof.jiggles.reduce((value, action) => Math.max(value, 4 * action.config.distanceM / action.strokeDuration), 0)
      : 0;
    const peak = Math.max(vmax, jigglePeak);
    vmax = Math.max(0.01, peak * 1.1);
    if (signed) vmin = -vmax;
    const GW = 1000, GH = 132, padL = 4, padR = 4, padT = 10, padB = 20;
    const span = Math.max(1e-6, vmax - vmin);
    const yOf = (val) => padT + (1 - (val - vmin) / span) * (GH - padT - padB);
    const zeroY = yOf(0);
    const valueAtTime = (tt) => {
      if (!arr || !arr.length || !prof.t.length) return 0;
      if (tt <= 0) return arr[0] || 0;
      if (tt >= total) return arr[arr.length - 1] || 0;
      const geometryEnd = prof.t[prof.t.length - 1];
      if (tt > geometryEnd + 1e-9) {
        if (metric !== 'velocity') return 0;
        const pose = window.PM.poseAtTime(tt, pts, prof, derived.anchors, derived.mode, derived.rev);
        return pose ? pose.speed : 0;
      }
      let lo = 1, hi = prof.t.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (prof.t[mid] < tt) lo = mid + 1; else hi = mid; }
      const t0 = prof.t[lo - 1], t1 = prof.t[lo], u = t1 - t0 > 1e-6 ? (tt - t0) / (t1 - t0) : 0;
      return arr[lo - 1] + (arr[lo] - arr[lo - 1]) * u;
    };
    let poly = '';
    if (pts.length > 1 && arr && arr.length) {
      const N = 170;
      for (let k = 0; k <= N; k++) {
        const tt = (k / N) * total;
        const val = valueAtTime(tt);
        const x = padL + (k / N) * (GW - padL - padR);
        poly += (k === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + yOf(val).toFixed(1) + ' ';
      }
    }
    const baseY = signed ? zeroY : (GH - padB);
    const playX = padL + pct * (GW - padL - padR);
    const currentValue = valueAtTime(playTime), playY = yOf(currentValue);
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
          h('span', { className: 'velgraph-ttl' }, title + ' profile'),
          h('span', { className: 'velgraph-readout' },
            h('b', null, currentValue.toFixed(metric === 'angvel' ? 0 : metric === 'curvature' ? 2 : 1) + ' ' + unit),
            h('span', null, 'Peak ' + peak.toFixed(metric === 'angvel' ? 0 : metric === 'curvature' ? 2 : 1) + ' ' + unit))),
        h('div', { className: 'velgraph-plot' },
          h('svg', { ref: graphRef, className: 'velgraph-svg', viewBox: `0 0 ${GW} ${GH}`, preserveAspectRatio: 'none', onPointerDown: onGraphDown, tabIndex: 0, role: 'slider', 'aria-label': title + ' graph playback position', 'aria-valuemin': 0, 'aria-valuemax': Math.round(total * 1000), 'aria-valuenow': Math.round(playTime * 1000), onKeyDown: (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(Math.max(0, Math.min(total, playTime + (e.key === 'ArrowRight' ? 1 : -1) * Math.max(0.02, total / 100)))); } else if (e.key === 'Home') { e.preventDefault(); seek(0); } else if (e.key === 'End') { e.preventDefault(); seek(total); } } },
            h('defs', null,
              h('linearGradient', { id: 'telemetry-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
                h('stop', { offset: '0%', stopColor: 'var(--accent)', stopOpacity: 0.24 }),
                h('stop', { offset: '100%', stopColor: 'var(--accent)', stopOpacity: 0.02 }))),
            [0.25, 0.5, 0.75].map((g) => h('line', { key: g, x1: padL, x2: GW - padR, y1: padT + g * (GH - padT - padB), y2: padT + g * (GH - padT - padB), stroke: '#ffffff', strokeOpacity: 0.05, strokeWidth: 1 })),
            signed && h('line', { x1: padL, x2: GW - padR, y1: zeroY, y2: zeroY, stroke: '#ffffff', strokeOpacity: 0.16, strokeWidth: 1 }),
            !signed && h('line', { x1: padL, x2: GW - padR, y1: GH - padB, y2: GH - padB, stroke: '#ffffff', strokeOpacity: 0.12, strokeWidth: 1 }),
            poly && h('path', { d: poly + `L ${GW - padR} ${baseY} L ${padL} ${baseY} Z`, fill: 'url(#telemetry-fill)' }),
            poly && h('path', { d: poly, fill: 'none', stroke: 'var(--accent)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: playX, x2: playX, y1: padT, y2: GH - padB, stroke: '#fff', strokeOpacity: 0.45, strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }),
            h('circle', { cx: playX, cy: playY, r: 4, fill: '#fff', stroke: 'var(--accent)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' })),
          h('div', { className: 'velgraph-time' }, h('span', null, '0s'), h('span', null, (total / 2).toFixed(1) + 's'), h('span', null, total.toFixed(1) + 's')))),
      h('div', { className: 'transport' },
        h('div', { className: 'timeline-toolbar' },
          h('div', { className: 'transport-controls' },
            h('button', { className: 'tbtn', type: 'button', onClick: restart, title: 'Restart', 'aria-label': 'Restart trajectory playback' }, h(Icon, { name: 'rewind', size: 14 })),
            h('button', { className: 'tbtn play', type: 'button', onClick: togglePlayback, title: 'Play / Pause  (Space)', 'aria-label': playing ? 'Pause trajectory playback' : 'Play trajectory' }, h(Icon, { name: playing ? 'pause' : 'play', size: 15, fill: !playing }))),
          h('span', { className: 'timeline-title' }, 'Timeline'),
          h('div', { className: 'timecode', 'aria-hidden': true },
            h('span', { className: 'timecode-now' }, playTime.toFixed(2)),
            h('span', { className: 'timecode-sep' }, '/'),
            h('span', { className: 'timecode-total' }, total.toFixed(2)),
            h('span', { className: 'timecode-unit' }, 's')),
          featureCount > 0 && h('span', { className: 'timeline-summary', 'aria-hidden': true }, featureSummary),
          h('div', { className: 'transport-meta' },
            h(MetricControl, { metric, setMetric, derived, diagOpen, onToggleDiag, plannerId }),
            h('div', { className: 'roi', title: 'Path length' }, h('span', { className: 'roi-v' }, (derived.totalDistance || derived.sample.length).toFixed(2)), h('span', { className: 'roi-u' }, 'm')),
            h(IconBtn, { icon: 'gauge', active: graphOpen, onClick: () => setGraphOpen(!graphOpen), title: 'Telemetry graph' }))),
        h('div', { className: 'timeline-editor' },
          h('div', { className: 'timeline' },
            h('div', { className: 'timeline-ruler', 'aria-hidden': true },
              timelineTicks.map((tick, index) => h('span', { key: tick.fraction, className: 'timeline-tick' + (index === 0 ? ' first' : index === timelineTicks.length - 1 ? ' last' : ''), style: { left: (tick.fraction * 100).toFixed(3) + '%' } },
                h('span', { className: 'timeline-tick-label' }, tick.label)))),
            h('div', { className: 'timeline-lanes' },
              h('span', { className: 'timeline-track', 'aria-hidden': true }),
              timelineTicks.map((tick) => h('span', { key: 'grid-' + tick.fraction, className: 'timeline-gridline', 'aria-hidden': true, style: { left: (tick.fraction * 100).toFixed(3) + '%' } })),
              timeline.ranges.map((range) => h('span', { key: range.key, className: 'timeline-range', title: range.label, 'aria-hidden': true, style: { left: range.left.toFixed(3) + '%', width: range.width.toFixed(3) + '%' } })),
              timeline.waypoints.map((waypoint) => h('span', { key: waypoint.key, className: 'timeline-waypoint' + (waypoint.stop ? ' stop' : ''), title: waypoint.label, 'aria-hidden': true, style: { left: waypoint.left.toFixed(3) + '%' } })),
              timeline.targets.map((target) => h('span', { key: target.key, className: 'timeline-target', title: target.label, 'aria-hidden': true, style: { left: target.left.toFixed(3) + '%' } })),
              timeline.markers.map((marker) => h('span', { key: marker.key, className: 'timeline-event', title: marker.label, 'aria-hidden': true, style: { left: marker.left.toFixed(3) + '%' } })),
              h('span', { className: 'timeline-playhead', 'aria-hidden': true, style: { left: (pct * 100).toFixed(3) + '%' } }),
              h('input', {
                className: 'scrub', type: 'range', 'aria-label': 'Trajectory playback position',
                'aria-describedby': 'trajectory-feature-summary',
                'aria-valuetext': playTime.toFixed(2) + ' seconds of ' + total.toFixed(2) + ' seconds',
                min: 0, max: total, step: scrubStep, value: Math.min(playTime, total),
                onChange: (e) => seek(+e.target.value),
                onKeyDown: (e) => {
                  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault(); seek(playTime + (e.key === 'ArrowRight' ? 0.1 : -0.1));
                  }
                },
                onPointerUp: (e) => e.currentTarget.blur()
              }),
              h('span', { id: 'trajectory-feature-summary', className: 'sr-only' }, featureSummary || 'No authored timeline features'))))));
  }

  // ---------------- zoom / view controls ----------------
  function ViewControls({ zoomPct, zoomBy, onFit, showGrid, setShowGrid }) {
    return h('div', { className: 'viewctl' },
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom out', 'aria-label': 'Zoom out', onClick: () => zoomBy(1.18) }, h(Icon, { name: 'zoomout', size: 16 })),
      h('button', { className: 'vc-pct', type: 'button', title: 'Fit field  (F)', onClick: onFit }, zoomPct + '%'),
      h('button', { className: 'vc-btn', type: 'button', title: 'Zoom in', 'aria-label': 'Zoom in', onClick: () => zoomBy(1 / 1.18) }, h(Icon, { name: 'zoomin', size: 16 })),
      h('div', { className: 'vc-div' }),
      h('button', { className: 'vc-btn' + (showGrid ? ' active' : ''), type: 'button', title: 'Toggle field grid  (G)', 'aria-label': 'Toggle field grid', 'aria-pressed': showGrid, onClick: () => setShowGrid(!showGrid) }, h(Icon, { name: 'grid', size: 16 })),
      h('button', { className: 'vc-btn', type: 'button', title: 'Fit field  (F)', 'aria-label': 'Fit field to view', onClick: onFit }, h(Icon, { name: 'fit', size: 16 })));
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

  window.Panels = { Toolbar, ToolRail, ConstraintBar, Outline, PathChecks, Transport, ViewControls, RoutineLegend };
})();
