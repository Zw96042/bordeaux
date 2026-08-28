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
            if (event.key === 'F2') { event.preventDefault(); rename(kind, item); return; }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const rows = [...root.current.querySelectorAll('[data-library-item]')]; const index = rows.indexOf(event.currentTarget);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            rows[next]?.focus(); const nextItem = items.find((value) => value.id === rows[next]?.dataset.libraryItem); if (nextItem) choose(nextItem, event);
          } }, h('span', { className: 'library-name' }, item.name),
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
    h('div', { className: 'library-tools' },
      h('button', { type: 'button', onClick: () => create(pathsMode ? 'path' : 'routine', () => pathsMode ? actions.addPath(active?.folderId) : actions.addRoutine()) }, h(Icon, { name: 'plus', size: 13 }), pathsMode ? 'New path' : 'New routine'),
      pathsMode && h('button', { type: 'button', title: 'New folder', 'aria-label': 'New folder', onClick: () => create('folder', actions.addFolder) }, h(Icon, { name: 'folder', size: 14 }))),
    h('input', { ref: search, className: 'library-search', type: 'search', 'aria-label': pathsMode ? 'Search paths and folders' : 'Search routines', placeholder: 'Search', value: prefs.query, onChange: (event) => { update({ query: event.target.value, scroll: 0 }); setMenu(null); } }),
    h('div', { ref: scroll, className: 'library-scroll', onScroll: (event) => update({ scroll: event.currentTarget.scrollTop }) },
      blocked && h('div', { className: 'library-blocked', role: 'alert' }, h('strong', null, 'Cannot delete ' + blocked.name), h('p', null, 'Remove its steps from these routines first:'), blocked.routines.map((routine) => h('button', { key: routine.id, type: 'button', onClick: () => onRoutine(routine.id) }, 'Open ' + routine.name))),
      !visible.length ? h('div', { className: 'library-empty' }, query ? 'No matching names.' : pathsMode ? 'Create a path to get started.' : 'Create a routine to get started.') : pathsMode && !query ? [...folders.map(group), ...visible.filter((item) => !item.folderId).map(row)] : visible.map(row)),
    h('div', { className: 'library-push' },
      h('div', { className: 'library-selection', role: 'status' },
        h('span', { className: 'library-current-name', title: pushName }, pathsMode && selected.length > 1 ? selected.length + ' paths selected' + (selected.some((id) => !visible.some((item) => item.id === id)) ? ' · includes hidden' : '') : pushName),
        pathsMode && selected.length > 1 && h('button', { type: 'button', onClick: () => update({ checked: [activeId], selectionActiveId: activeId }) }, 'Clear')),
      h('button', { type: 'button', disabled: controller.busy || !active || controller.desktopAvailable === false, onClick: () => controller.requestPush(pathsMode ? { kind: 'paths', pathIds: selected } : { kind: 'routine', routineId: active.id }) }, h(Icon, { name: 'share', size: 13 }), pathsMode ? selected.length > 1 ? 'Push ' + selected.length + ' paths' : 'Push path' : 'Push routine'),
      pathsMode && h('span', { className: 'library-selection-hint' }, 'Shift for a range · ⌘ / Ctrl for multiple')),
    menu && menuItem && h(LibraryMenu, { key: menu.id, menu, close: closeMenu },
      menuButton('Rename', () => rename(menu.kind, menuItem)),
      menu.kind !== 'folder' && menuButton('Duplicate', () => create(menu.kind, () => pathsMode ? actions.duplicatePath(menuItem.id) : actions.duplicateRoutine(menuItem.id))),
      menu.kind === 'path' && menuButton('Append path', () => create('path', () => actions.appendPath(menuItem.id))),
      menu.kind === 'path' && menuButton('Folder and links…', () => { setPropertiesId(menuItem.id); setMenu(null); }),
      menu.kind === 'folder' && menuButton('New path', () => create('path', () => actions.addPath(menuItem.id))),
      h('hr'), menuButton(menu.kind === 'folder' ? 'Delete folder' : 'Delete', () => remove(menu.kind, menuItem), { className: 'danger', disabled: menu.kind !== 'folder' && items.length <= 1 })),
    properties && h(PathProperties, { item: properties, project, actions, close: () => { setPropertiesId(null); focusRow(propertiesId); } }));
}
