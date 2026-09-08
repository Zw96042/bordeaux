import * as React from 'react';
import { UI } from './ui';
import { AUTO } from '../lib/routineModel';

const h = React.createElement;
const { useState, useRef, useEffect } = React;
const { Icon } = UI;
const memory = new Map();
const defaults = () => ({ query: '', collapsed: {}, scroll: 0, structureScroll: 0, checked: [], ratio: 48, libraryOpen: true, sections: { wp: true, sg: false, rt: false, em: false, cr: false } });

function readPreferences(key) {
  if (memory.has(key)) return memory.get(key);
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(key) || '{}') }; }
  catch (_) { return defaults(); }
}

export function referencingRoutines(routines, pathId) {
  const references = (nodes) => (nodes || []).some((node) =>
    (node.type === 'path' && node.ref === pathId)
    || (node.type === 'decision' && (references(node.then) || references(node.else)))
    || (node.type === 'generatedTrajectory' && node.fallback?.type === 'branch' && references(node.fallback.nodes)));
  return routines.filter((routine) => references(routine.nodes));
}

export function selectedPathIds(paths, checkedIds) {
  const checked = new Set(checkedIds);
  return paths.filter((path) => checked.has(path.id)).map((path) => path.id);
}

export function LibraryRail({ preferenceKey, mode, children, ...props }) {
  const storageKey = 'bordeaux.library.' + preferenceKey + '.' + mode;
  const [prefs, setPrefs] = useState(() => readPreferences(storageKey));
  const latest = useRef(prefs), rail = useRef(null), structureBody = useRef(null), timer = useRef(null);
  const update = (patch) => {
    const next = { ...latest.current, ...patch };
    latest.current = next; memory.set(storageKey, next); setPrefs(next);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(latest.current)); } catch (_) { /* Preferences can remain session-only. */ } }, 200);
    return () => clearTimeout(timer.current);
  }, [prefs, storageKey]);
  useEffect(() => () => { try { localStorage.setItem(storageKey, JSON.stringify(latest.current)); } catch (_) { /* Preferences can remain session-only. */ } }, [storageKey]);
  useEffect(() => {
    const scroller = structureBody.current?.querySelector('.outline-scroll,.rt-scroll');
    if (scroller) scroller.scrollTop = prefs.structureScroll;
  }, []);
  const resize = (event) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = rail.current.getBoundingClientRect();
    update({ ratio: Math.max(25, Math.min(75, (event.clientY - bounds.top) / bounds.height * 100)) });
  };
  return h('nav', { ref: rail, className: 'rail rail-l library-rail' + (children ? '' : ' library-only'), 'aria-label': mode === 'paths' ? 'Paths and outline' : 'Routines',
    style: { '--library-ratio': prefs.ratio + '%' },
    onKeyDown: (event) => { if (event.target.closest('.editor-library,.library-divider')) event.stopPropagation(); } },
    h('section', { className: 'library-top' },
      h(EditorLibrary, { ...props, mode, prefs, update })),
    children && h('div', { className: 'library-divider', role: 'separator', tabIndex: 0, 'aria-label': 'Resize library and structure', 'aria-orientation': 'horizontal', 'aria-valuemin': 25, 'aria-valuemax': 75, 'aria-valuenow': Math.round(prefs.ratio),
      onPointerDown: (event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); }, onPointerMove: resize,
      onPointerUp: (event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); },
      onKeyDown: (event) => { const change = { ArrowUp: -5, ArrowDown: 5, Home: 25 - prefs.ratio, End: 75 - prefs.ratio }[event.key]; if (change !== undefined) { event.preventDefault(); update({ ratio: Math.max(25, Math.min(75, prefs.ratio + change)) }); } } }),
    children && h('section', { className: 'library-structure' },
      h('div', { className: 'library-section-title' }, mode === 'paths' ? 'Path outline' : 'Routine steps'),
      h('div', { ref: structureBody, className: 'library-structure-body', onScrollCapture: (event) => { if (event.target.matches('.outline-scroll,.rt-scroll')) update({ structureScroll: event.target.scrollTop }); } }, children(prefs.sections, (sections) => update({ sections: typeof sections === 'function' ? sections(latest.current.sections) : sections })))));
}

function LibraryMenu({ menu, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    const onToggle = (event) => { if (event.newState === 'closed') close(false); };
    element.addEventListener('toggle', onToggle);
    element.showPopover();
    const bounds = element.getBoundingClientRect();
    element.style.top = Math.max(8, Math.min(menu.top, window.innerHeight - bounds.height - 8)) + 'px';
    element.style.left = Math.max(8, Math.min(menu.left, window.innerWidth - bounds.width - 8)) + 'px';
    element.querySelector('button:not(:disabled)')?.focus();
    return () => element.removeEventListener('toggle', onToggle);
  }, []);
  return h('div', { ref, popover: 'auto', className: 'library-menu', role: 'menu', 'aria-label': menu.name + ' actions',
    style: { left: Math.min(menu.left, window.innerWidth - 216), top: Math.max(8, Math.min(menu.top, window.innerHeight - 250)) },
    onKeyDown: (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (event.key === 'Tab') close(false);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')]; const index = buttons.indexOf(document.activeElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    } }, children);
}

function PathProperties({ item, project, actions, close }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  const outgoing = project.pathLinks?.find((link) => link.fromPathId === item.id);
  const incoming = project.pathLinks?.find((link) => link.toPathId === item.id);
  return h('dialog', { ref, className: 'library-properties', 'aria-labelledby': 'path-properties-title', onClose: close, onKeyDown: (event) => event.stopPropagation() },
    h('header', null, h('strong', { id: 'path-properties-title' }, item.name), h('button', { type: 'button', 'aria-label': 'Close path properties', onClick: close }, h(Icon, { name: 'x', size: 16 }))),
    h('label', null, 'Folder', h('select', { 'aria-label': 'Move ' + item.name + ' to folder', value: item.folderId || '', onChange: (event) => actions.movePath(item.id, event.target.value) },
      h('option', { value: '' }, 'No folder'), (project.pathFolders || []).map((folder) => h('option', { key: folder.id, value: folder.id }, folder.name)))),
    h('label', null, 'Link end to path', h('select', { 'aria-label': 'Link end of ' + item.name, value: outgoing?.toPathId || '', onChange: (event) => actions.linkPath(item.id, event.target.value) },
      h('option', { value: '' }, 'Not linked'), project.paths.filter((path) => path.id !== item.id).map((path) => h('option', { key: path.id, value: path.id }, path.name)))),
    incoming && h('div', { className: 'library-link' }, 'Start linked from ' + (project.paths.find((path) => path.id === incoming.fromPathId)?.name || 'another path'), h('button', { type: 'button', onClick: () => actions.linkPath(incoming.fromPathId, '') }, 'Unlink')),
    h('footer', null, h('button', { type: 'button', onClick: close }, 'Done')));
}

function EditorLibrary({ mode, prefs, update, project, routines, activePathId, activeRoutineId, onMode, onPath, onRoutine, actions, times, controller, projectLocation, saveState, onOpenFolder, onSaveProject, onRetrySave }) {
  const pathsMode = mode === 'paths';
  const items = pathsMode ? project.paths : routines;
  const activeId = pathsMode ? activePathId : activeRoutineId;
  const active = items.find((item) => item.id === activeId);
  const folders = project.pathFolders || [];
  const [menu, setMenu] = useState(null), [editing, setEditing] = useState(null), [propertiesId, setPropertiesId] = useState(null);
  const [draft, setDraft] = useState(''), [error, setError] = useState(''), [blocked, setBlocked] = useState(null);
  const search = useRef(null), edit = useRef(null), scroll = useRef(null), root = useRef(null), anchor = useRef(activeId);
  const previousActiveId = useRef(activeId);
  useEffect(() => {
    if (previousActiveId.current !== activeId) { update({ checked: [activeId], selectionActiveId: activeId }); previousActiveId.current = activeId; anchor.current = activeId; }
  }, [activeId]);
  const checked = prefs.selectionActiveId === activeId ? selectedPathIds(project.paths, prefs.checked) : [];
  const selected = pathsMode && checked.length ? checked : active ? [active.id] : [];
  const folderName = (id) => folders.find((folder) => folder.id === id)?.name || '';
  const query = prefs.query.trim().toLowerCase();
  const visible = items.filter((item) => (item.name + (pathsMode ? ' ' + folderName(item.folderId) : '')).toLowerCase().includes(query));
  const displayed = pathsMode && !query ? [...folders.flatMap((folder) => prefs.collapsed[folder.id] ? [] : visible.filter((item) => item.folderId === folder.id)), ...visible.filter((item) => !item.folderId)] : visible;
  const focusRow = (id) => requestAnimationFrame(() => {
    const target = [...(root.current?.querySelectorAll('[data-library-item]') || [])].find((item) => item.dataset.libraryItem === id);
    (target || search.current)?.focus();
  });
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = prefs.scroll; }, []);
  useEffect(() => { if (editing) { edit.current?.focus(); edit.current?.select(); } }, [editing]);
  useEffect(() => { if (checked.length !== prefs.checked.length) update({ checked, selectionActiveId: activeId }); }, [project.paths]);
  const closeMenu = (restore) => { if (restore) menu?.trigger?.focus(); setMenu(null); };
  const openMenu = (event, kind, item) => {
    event.preventDefault(); event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenu({ id: item.id, name: item.name, kind, trigger: event.currentTarget, left: event.type === 'contextmenu' ? event.clientX : bounds.left, top: event.type === 'contextmenu' ? event.clientY : bounds.bottom + 3 });
  };
  const choose = (item, event = {}) => {
    setMenu(null); setBlocked(null);
    if (!pathsMode) { onRoutine(item.id); return; }
    if (event.shiftKey) {
      const from = Math.max(0, displayed.findIndex((path) => path.id === anchor.current)); const to = displayed.findIndex((path) => path.id === item.id);
      const range = displayed.slice(Math.min(from, to), Math.max(from, to) + 1).map((path) => path.id);
      update({ checked: event.metaKey || event.ctrlKey ? [...new Set([...selected, ...range])] : range, selectionActiveId: activeId });
      return;
    }
    anchor.current = item.id;
    if (event.metaKey || event.ctrlKey) {
      const next = selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id];
      update({ checked: next.length ? next : [item.id], selectionActiveId: activeId });
      return;
    }
    update({ checked: [item.id], selectionActiveId: item.id }); onPath(item.id);
  };
  const finish = (id) => { setEditing(null); setError(''); focusRow(id); };
  const rename = (kind, item) => { setMenu(null); setEditing({ kind, id: item.id }); setDraft(item.name); setError(''); };
  const create = (kind, operation) => {
    setMenu(null); const created = operation();
    if (created) { update({ query: '', libraryOpen: true, checked: [], collapsed: { ...prefs.collapsed, [created.folderId || active?.folderId || '_unfiled']: false } }); rename(kind, created); }
  };
  const remove = (kind, item) => {
    setMenu(null);
    if (kind === 'path') {
      const refs = referencingRoutines(routines, item.id);
      if (refs.length) { setBlocked({ name: item.name, routines: refs }); return; }
    }
    const removed = kind === 'path' ? actions.deletePath(item.id) : kind === 'routine' ? actions.deleteRoutine(item.id) : actions.deleteFolder(item.id);
    if (removed) focusRow(activeId === item.id ? '' : activeId);
  };
  const editForm = () => h('form', { className: 'library-rename', onSubmit: (event) => {
    event.preventDefault(); const clean = draft.trim(); if (!clean) { setError('Enter a name.'); return; }
    const ok = editing.kind === 'path' ? actions.renamePath(editing.id, clean) : editing.kind === 'routine' ? actions.renameRoutine(editing.id, clean) : actions.renameFolder(editing.id, clean);
    if (ok) finish(editing.id); else setError('This name could not be saved.');
  } }, h('input', { ref: edit, 'aria-label': 'Name', 'aria-invalid': !!error, value: draft, onChange: (event) => { setDraft(event.target.value); setError(''); } }),
    h('button', { type: 'submit', 'aria-label': 'Save name' }, h(Icon, { name: 'check', size: 14 })),
    h('button', { type: 'button', 'aria-label': 'Cancel rename', onClick: () => finish(editing.id) }, h(Icon, { name: 'x', size: 14 })),
    error && h('span', { className: 'library-error', role: 'alert' }, error));
  const row = (item) => {
    const kind = pathsMode ? 'path' : 'routine', status = controller.itemStatus(kind, item.id);
    const duration = times[item.id];
    const durationText = duration?.status === 'ready' ? duration.seconds.toFixed(2) + ' s' : duration?.status === 'error' ? '—' : '…';
    const durationTitle = duration?.status === 'ready' ? 'Trajectory time' : duration?.status === 'error' ? 'Trajectory time unavailable: ' + duration.message : 'Computing trajectory time';
    return h('div', { key: item.id, className: 'library-item' }, editing?.id === item.id ? editForm() :
      h('div', { className: 'library-row' + (selected.includes(item.id) ? ' selected' : ''), onContextMenu: (event) => openMenu(event, kind, item) },
        h('button', { className: 'library-pick', type: 'button', 'data-library-item': item.id, 'aria-current': item.id === activeId ? 'true' : undefined, 'aria-pressed': selected.includes(item.id), title: item.name + '\n' + status.detail,
          onClick: (event) => choose(item, event), onDoubleClick: () => rename(kind, item),
          onKeyDown: (event) => {
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(kind, item); return; }
            if (event.key === 'F2') { event.preventDefault(); rename(kind, item); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const rows = [...root.current.querySelectorAll('[data-library-item]')]; const index = rows.indexOf(event.currentTarget);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            rows[next]?.focus(); const nextItem = items.find((value) => value.id === rows[next]?.dataset.libraryItem); if (nextItem) choose(nextItem, event);
          } }, h(Icon, { name: pathsMode ? 'route' : 'branch', size: 14 }), h('span', { className: 'library-name' }, item.name),
          h('span', { className: 'library-meta', title: pathsMode ? durationTitle : status.label + ': ' + status.detail }, pathsMode ? durationText : AUTO.countSteps(item) + (AUTO.countSteps(item) === 1 ? ' step' : ' steps'))),
        h('button', { className: 'library-more', type: 'button', 'aria-label': 'Actions for ' + item.name, 'aria-haspopup': 'menu', 'aria-expanded': menu?.id === item.id, onClick: (event) => openMenu(event, kind, item) }, '…')));
  };
  const group = (folder) => {
    const id = folder.id, members = items.filter((item) => item.folderId === id), collapsed = prefs.collapsed[id];
    return h('section', { key: id, className: 'library-group' },
      editing?.kind === 'folder' && editing.id === id ? editForm() : h('div', { className: 'library-folder', onContextMenu: (event) => openMenu(event, 'folder', folder) },
        h('button', { type: 'button', 'aria-expanded': !collapsed, onClick: () => update({ collapsed: { ...prefs.collapsed, [id]: !collapsed } }) }, h(Icon, { name: 'chevron', size: 12 }), h(Icon, { name: 'folder', size: 13 }), h('span', null, folder.name)),
        h('button', { className: 'library-more', type: 'button', 'aria-label': 'Actions for folder ' + folder.name, 'aria-haspopup': 'menu', onClick: (event) => openMenu(event, 'folder', folder) }, '…')),
      !collapsed && (members.length ? members.map(row) : h('div', { className: 'library-empty' }, 'Empty folder')));
  };
  const menuItem = menu?.kind === 'folder' ? folders.find((item) => item.id === menu.id) : items.find((item) => item.id === menu?.id);
  const properties = project.paths.find((item) => item.id === propertiesId);
  const pushName = pathsMode ? project.paths.find((item) => item.id === selected[0])?.name : active?.name;
  const menuButton = (label, onClick, props = {}) => h('button', { type: 'button', role: 'menuitem', onClick, ...props }, label);
  return h('div', { ref: root, className: 'editor-library', onKeyDown: (event) => {
    if (event.target.closest('dialog')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && pathsMode && !event.target.matches('input')) { event.preventDefault(); update({ checked: displayed.map((item) => item.id), selectionActiveId: activeId }); }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (editing) finish(editing.id); else if (menu) closeMenu(true); else if (blocked) setBlocked(null); else if (selected.length > 1) update({ checked: [activeId], selectionActiveId: activeId }); else { update({ query: '' }); search.current?.focus(); }
  } },
    h('div', { className: 'library-tabs', role: 'tablist', 'aria-label': 'Library' }, ['paths', 'routines'].map((tab) => h('button', { key: tab, type: 'button', role: 'tab', 'aria-selected': tab === mode, tabIndex: tab === mode ? 0 : -1,
      onClick: () => { if (tab !== mode) onMode(tab); }, onKeyDown: (event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onMode(pathsMode ? 'routines' : 'paths'); requestAnimationFrame(() => document.querySelector('.library-tabs [aria-selected="true"]')?.focus()); } } }, tab === 'paths' ? 'Paths' : 'Routines'))),
    h('div', { className: 'library-location' },
      h('button', { type: 'button', className: 'library-location-folder', onClick: onOpenFolder, title: projectLocation?.folderPath || 'Choose where paths and routines are saved', 'aria-label': projectLocation?.folderPath ? 'Open another project folder' : 'Open project folder' },
        h(Icon, { name: 'folder', size: 14 }), h('span', null, projectLocation?.folderPath?.split(/[\\/]/).filter(Boolean).pop() || 'Open folder')),
      h('div', { className: 'library-save-status', role: saveState?.status === 'error' ? 'alert' : 'status' },
        saveState?.status === 'error' ? h(React.Fragment, null, h('span', { title: saveState.error }, saveState.error), h('button', { type: 'button', onClick: onRetrySave }, 'Retry save'))
          : saveState?.status === 'saving' ? 'Saving…'
          : projectLocation?.folderPath ? h(React.Fragment, null, h('span', null, 'Autosave on'), !projectLocation.projectPath && h('button', { type: 'button', onClick: onSaveProject }, 'Save project settings'))
          : 'Choose a folder to autosave files')),
    h('div', { className: 'library-tools' },
      h('button', { type: 'button', onClick: () => create(pathsMode ? 'path' : 'routine', () => pathsMode ? actions.addPath(active?.folderId) : actions.addRoutine()) }, h(Icon, { name: 'plus', size: 13 }), pathsMode ? 'New path' : 'New routine'),
      pathsMode && h('button', { type: 'button', title: 'New folder', 'aria-label': 'New folder', onClick: () => create('folder', actions.addFolder) }, h(Icon, { name: 'folder', size: 14 }))),
    h('input', { ref: search, className: 'library-search', type: 'search', 'aria-label': pathsMode ? 'Search paths and folders' : 'Search routines', placeholder: 'Search', value: prefs.query, onChange: (event) => { update({ query: event.target.value, scroll: 0 }); setMenu(null); } }),
    h('div', { ref: scroll, className: 'library-scroll', onScroll: (event) => update({ scroll: event.currentTarget.scrollTop }) },
      blocked && h('div', { className: 'library-blocked', role: 'alert' }, h('strong', null, 'Cannot delete ' + blocked.name), h('p', null, 'Remove its steps from these routines first:'), blocked.routines.map((routine) => h('button', { key: routine.id, type: 'button', onClick: () => onRoutine(routine.id) }, 'Open ' + routine.name))),
      !visible.length ? h('div', { className: 'library-empty' }, query ? 'No matching names.' : pathsMode ? 'Create a path to get started.' : 'Create a routine to get started.') : pathsMode && !query ? [...folders.map(group), ...visible.filter((item) => !item.folderId).map(row)] : visible.map(row)),
    h('div', { className: 'library-push' },
      h('div', { className: 'library-selection', role: 'status' },
        h('span', { className: 'library-current-name', title: pushName }, pathsMode && selected.length > 1 ? selected.length + ' paths selected' + (selected.some((id) => !visible.some((item) => item.id === id)) ? ', includes hidden' : '') : pushName),
        pathsMode && selected.length > 1 && h('button', { type: 'button', onClick: () => update({ checked: [activeId], selectionActiveId: activeId }) }, 'Clear')),
      h('button', { type: 'button', disabled: controller.busy || !active || controller.desktopAvailable === false, onClick: () => controller.requestPush(pathsMode ? { kind: 'paths', pathIds: selected } : { kind: 'routine', routineId: active.id }) }, h(Icon, { name: 'share', size: 13 }), pathsMode ? selected.length > 1 ? 'Push ' + selected.length + ' paths' : 'Push path' : 'Push routine'),
      pathsMode && h('span', { className: 'library-selection-hint' }, 'Shift: select range. ⌘ / Ctrl: select multiple.')),
    menu && menuItem && h(LibraryMenu, { key: menu.id, menu, close: closeMenu },
      menu.kind !== 'folder' && menuButton(pathsMode ? 'Push path…' : 'Push routine…', () => {
        setMenu(null); controller.requestPush(pathsMode ? { kind: 'paths', pathIds: [menuItem.id] } : { kind: 'routine', routineId: menuItem.id });
      }, { disabled: controller.busy || controller.desktopAvailable === false }),
      menu.kind === 'path' && menuButton('Export BDX…', () => { const pathId = menuItem.id; setMenu(null); actions.exportPath(pathId); }, { disabled: controller.desktopAvailable === false }),
      menu.kind !== 'folder' && h('hr'),
      menuButton('Rename', () => rename(menu.kind, menuItem)),
      menu.kind !== 'folder' && menuButton('Duplicate', () => create(menu.kind, () => pathsMode ? actions.duplicatePath(menuItem.id) : actions.duplicateRoutine(menuItem.id))),
      menu.kind === 'path' && menuButton('Append path', () => create('path', () => actions.appendPath(menuItem.id))),
      menu.kind === 'path' && menuButton('Move or link…', () => { setPropertiesId(menuItem.id); setMenu(null); }),
      menu.kind === 'folder' && menuButton('New path', () => create('path', () => actions.addPath(menuItem.id))),
      h('hr'), menuButton(menu.kind === 'folder' ? 'Delete folder' : 'Delete', () => remove(menu.kind, menuItem), { className: 'danger', disabled: menu.kind !== 'folder' && items.length <= 1 })),
    properties && h(PathProperties, { item: properties, project, actions, close: () => { setPropertiesId(null); focusRow(propertiesId); } }));
}
