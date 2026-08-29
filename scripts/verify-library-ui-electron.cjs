const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.BORDEAUX_LIBRARY_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
const errors = [], checks = [], prepared = [], diagnosticPreviews = [], diagnosticSaves = [];
let win, saved, finishPush;
let connectionFromSettings = false;
let deferInspection = false, finishInspection;
const inspection = () => ({ verifiedAt: new Date().toISOString(), comparison: { paths: {}, routines: {} }, status: { activeRevision: 'fixture-revision', retainedRevisions: [] } });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(50); } throw new Error('Timed out: ' + label); }
async function click(selector, text) {
  if (selector === '.library-connection' && !(await evaluate(() => document.querySelector('.settings-general')))) {
    await click('.pageswitch button', 'Settings'); connectionFromSettings = true;
  }
  await evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((item) => text == null || item.textContent.trim() === text);
    if (!el || el.disabled || el.closest('[inert]')) throw new Error('Unavailable: ' + selector + ' ' + text);
    el.click();
  }, selector, text); await delay(50);
  if (connectionFromSettings && (selector === '[aria-label="Close robot connection"]' || selector === '[aria-label="Close diagnostic bundle"]')) {
    connectionFromSettings = false; await click('.pageswitch button', 'Editor');
  }
}
async function pointerClick(selector, modifiers = []) {
  const point = await evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el || el.disabled || el.closest('[inert]')) throw new Error('Unavailable pointer target: ' + selector);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, selector);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1, modifiers });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1, modifiers });
  await delay(80);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await delay(60);
}
async function input(selector, value) {
  await evaluate((selector, value) => {
    const el = document.querySelector(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value); await delay(50);
}
const check = (name) => { checks.push(name); console.log('PASS ' + name); };
ipcMain.handle('library:restore', () => ({ project: saved }));
ipcMain.handle('library:save', (_event, project) => { saved = project; return { saved: true }; });
ipcMain.handle('library:diagnostic-preview', (_event, project) => {
  diagnosticPreviews.push(project);
  return { previewId: 'fixture-preview-capability', contents: JSON.stringify({ version: 'fixture', project: project.name }) };
});
ipcMain.handle('library:diagnostic-save', (_event, previewId) => {
  assert.equal(previewId, 'fixture-preview-capability'); diagnosticSaves.push(previewId);
  return { saved: true };
});
ipcMain.handle('library:prepare', (_event, project, scope) => {
  prepared.push({ project, scope });
  const selected = scope.kind === 'paths' ? project.paths.filter((item) => scope.pathIds.includes(item.id)) : project.routines.filter((item) => item.id === scope.routineId);
  return { operationId: 'fixture-operation', robot: 'Team 2468', project: project.name, catalog: 'Fixture catalog', revision: 'fixture-revision', payloadHash: 'fixture-hash', size: 100,
    summary: { kind: scope.kind, pathIds: scope.pathIds || [], selectedNames: selected.map((item) => item.name), addedNames: [], updatedNames: selected.map((item) => item.name), preservedPathCount: project.paths.length - (scope.pathIds?.length || 0), routine: 'Routine A' } };
});
ipcMain.handle('library:confirm', () => new Promise((resolve) => { finishPush = resolve; }));
ipcMain.handle('library:inspect', () => deferInspection ? new Promise((resolve) => { finishInspection = resolve; }) : inspection());
app.whenReady().then(async () => {
  try {
    const corpus = JSON.parse(await fs.readFile(path.resolve('benchmarks/planner-corpus/v1/corpus.bordeaux.json'), 'utf8'));
    const source = corpus.paths.find((item) => item.id === 'corpus-neutral-stop');
    saved = { ...corpus, name: 'Library verification', paths: Array.from({ length: 200 }, (_, index) => ({ ...structuredClone(source), id: 'library-path-' + index, name: index === 0 ? 'Opening move' : index === 1 ? 'Collect second' : 'Practice path ' + index, folderId: 'center' })),
      pathFolders: [{ id: 'center', name: 'Center' }, { id: 'side', name: 'Side' }], pathLinks: [],
      routines: [{ id: 'routine-a', name: 'Routine A', nodes: [{ id: 'step-a', type: 'path', ref: 'library-path-0' }, { id: 'decision-a', type: 'decision', cond: '', thenLabel: 'Piece collected', elseLabel: 'Try again', then: [{ id: 'step-then', type: 'path', ref: 'library-path-1' }], else: [{ id: 'step-else', type: 'path', ref: 'library-path-0' }] }, { id: 'step-finish', type: 'path', ref: 'library-path-1' }] }, { id: 'routine-b', name: 'Routine B', nodes: [] }], activeRoutineId: 'routine-a', editor: { activePathId: 'library-path-0' } };
    win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'verify-library-ui-preload.cjs') } });
    win.webContents.on('console-message', (details) => { if (details.level === 'error' && !details.message.startsWith("Loading the font 'data:font/woff2")) errors.push(details.message); });
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-current-name')?.textContent === 'Opening move'), 'restored library');
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick').length), 200);
    assert.equal(await evaluate(() => document.querySelectorAll('.library-row input[type="checkbox"]').length), 0, 'Normal browsing must not show batch-selection controls');
    assert.equal(await evaluate(() => document.querySelectorAll('.toolbar .library-connection,.toolbar .document-settings-trigger,.toolbar .exportjava').length), 0);
    await click('.pageswitch button', 'Settings');
    assert.equal(await evaluate(() => !!document.querySelector('.settings-general .library-connection')), true);
    await click('[aria-label="Display units"] button', 'Imperial');
    assert.equal(await evaluate(() => [...document.querySelectorAll('[aria-label="Display units"] button')].find((button) => button.textContent === 'Imperial').getAttribute('aria-pressed')), 'true');
    await click('.rp-shapes button', 'Custom');
    const vertexValue = async (raw, cancel = false) => {
      await evaluate(() => { const el = document.querySelector('[aria-label="Vertex 1 X"]'); el.focus(); el.select(); });
      await win.webContents.insertText(raw);
      if (cancel) { await key('Escape'); await evaluate(() => document.querySelector('[aria-label="Vertex 1 X"]').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); }
      else await evaluate(() => { const el = document.querySelector('[aria-label="Vertex 1 X"]'); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur(); });
      await click('[aria-label="Save project"]');
      return saved.robot.footprint.verticesM[0].x;
    };
    assert.ok(Math.abs(await vertexValue('-10') + .254) < 1e-10, 'Imperial footprint edits store canonical meters');
    for (const invalid of ['', 'NaN', '2oops']) assert.ok(Math.abs(await vertexValue(invalid) + .254) < 1e-10);
    assert.ok(Math.abs(await vertexValue('-12', true) + .254) < 1e-10, 'Escape preserves footprint position');
    assert.equal(await evaluate(() => document.querySelector('[aria-label="Vertex 1 X"]').nextElementSibling.textContent), 'in');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(100);
      await evaluate(() => document.querySelector('[aria-label="Vertex 1 X"]').scrollIntoView({ block: 'center' }));
      assert.equal(await evaluate(() => { const row = document.querySelector('.rp-vertex'); return row.scrollWidth <= row.clientWidth; }), true);
      await fs.writeFile(path.join(output, `custom-footprint-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    win.setContentSize(1440, 900);
    await click('[aria-label="Display units"] button', 'Metric');
    assert.equal(await evaluate(() => document.querySelector('[aria-label="Vertex 1 X"]').value), '-0.254');
    await click('.rp-shapes button', 'Rectangle');
    check('custom footprint respects displayed units, invalid drafts, Escape, and narrow layout');
    await click('.pageswitch button', 'Editor');
    check('Settings contains connection and working display units; toolbar has no connection, units, or JSON export');
    await wait(() => evaluate(() => document.querySelector('[data-role="wp"]') && !document.querySelector('.fieldcol[inert]')), 'editable field');
    await pointerClick('.wpfeatrow:nth-child(2) .featselect', ['shift']);
    await click('[aria-label="Save project"]');
    assert.equal(saved.paths[0].waypoints.length, 3, 'Shift selection must never delete a waypoint');
    assert.equal(await evaluate(() => document.querySelector('.wpfeatrow:nth-child(2) .featselect').getAttribute('aria-pressed')), 'true');
    check('Shift-click selects a waypoint without deleting it');
    await evaluate(() => document.querySelectorAll('.outline .featselect')[1].click());
    const numericBefore = await evaluate(() => document.querySelector('.numinput').value);
    await evaluate(() => { const field = document.querySelector('.numinput'); field.focus(); field.select(); });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '2' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '2' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '2' });
    await delay(80);
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('.numinput')), true, 'Typing a number must keep numeric input focus');
    assert.equal(await evaluate(() => document.querySelector('.numinput').value), '2');
    assert.equal(await evaluate(() => document.querySelector('[title="Place waypoint  (2 or W)"]')?.getAttribute('aria-pressed')), 'false');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await delay(80);
    await evaluate(() => document.querySelectorAll('.outline .featselect')[1].click());
    assert.equal(await evaluate(() => document.querySelector('.numinput').value), numericBefore, 'Escape must discard the numeric draft');
    check('numeric typing preserves focus and tool selection, and Escape discards the draft');
    await wait(() => evaluate(() => document.querySelector('[data-heading-control]') && !document.querySelector('.fieldcol[inert]')), 'heading menu target');
    await evaluate(() => document.querySelector('[data-heading-control]').focus());
    await key('F10', ['shift']);
    await wait(() => evaluate(() => document.querySelector('.ctxmenu [role="menuitem"]') === document.activeElement), 'heading menu focus');
    await key('End');
    assert.equal(await evaluate(() => document.activeElement.textContent), 'Type exact angle…');
    await key('Home'); await key('Down');
    assert.equal(await evaluate(() => document.activeElement.textContent), 'Face previous waypoint');
    await key('Escape');
    assert.equal(await evaluate(() => Boolean(document.querySelector('.ctxmenu'))), false);
    assert.equal(await evaluate(() => document.activeElement.hasAttribute('data-heading-control')), true);
    assert.equal(await evaluate(() => document.querySelector('.wpfeatrow:nth-child(2) .featselect').getAttribute('aria-pressed')), 'true');
    check('heading menu opens by keyboard, navigates, and restores focus without clearing selection');
    await click('[aria-label="Hide inspector"]');
    const headingPoint = await evaluate(() => { const r = document.querySelector('[data-heading-control]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...headingPoint, button: 'right', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...headingPoint, button: 'right', clickCount: 1 });
    await wait(() => evaluate(() => !!document.querySelector('.ctxmenu')), 'pointer heading menu');
    for (const code of ['Left', 'Right', 'Delete']) await key(code);
    await key('End'); await key('Space');
    await wait(() => evaluate(() => document.querySelector('.rail-r input') && !document.querySelector('.ctxmenu')), 'exact angle inspector opens from menu Space');
    await click('[aria-label="Save project"]');
    assert.deepEqual(saved.paths[0].waypoints, source.waypoints, 'Menu key navigation must not nudge or delete geometry');
    check('pointer-opened heading menu isolates editor keys and Space opens the exact-angle inspector');



    const beforeModal = structuredClone(saved.paths[0].waypoints);
    for (const diagnostic of [false, true]) {
      await click('.library-connection');
      await wait(() => evaluate(() => document.querySelector('dialog.robot-manager').open), 'robot connection modal');
      if (diagnostic) await click('[aria-label="Diagnostics"]');
      const closeSelector = diagnostic ? '[aria-label="Close diagnostic bundle"]' : '[aria-label="Close robot connection"]';
      if (diagnostic) {
        await evaluate(() => [...document.querySelectorAll('[aria-labelledby="beta-diagnostic-title"] button')].at(-1).focus());
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await delay(80);
        assert.equal(await evaluate(() => document.querySelector('[aria-labelledby="beta-diagnostic-title"]').contains(document.activeElement)), true, 'Tab must stay inside the diagnostic modal');
        await fs.writeFile(path.join(output, 'diagnostic-dialog.png'), (await win.webContents.capturePage()).toPNG());
      }
      await evaluate((selector) => document.querySelector(selector).focus(), closeSelector);
      for (const keyCode of ['Delete', 'Right', '2']) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      }
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: ['control'] });
      await delay(80);
      assert.equal(await evaluate((selector) => document.activeElement === document.querySelector(selector), closeSelector), true, 'Editor shortcuts must not blur a modal control');
      await click(closeSelector);
      await click('[aria-label="Save project"]');
      assert.deepEqual(saved.paths[0].waypoints, beforeModal, 'Modal keys must not modify the path behind the dialog');
    }
    check('robot and diagnostic modals isolate editor tool, nudge, delete, and undo shortcuts');
    const maxVelocityBefore = saved.paths[0].constraints.maxVel;
    await click('.cbar');
    const enterVelocity = async (raw) => {
      await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'editable numeric constraints');
      await evaluate(() => {
        const input = [...document.querySelectorAll('.numrow')].find((row) => row.querySelector('label')?.textContent === 'Max vel').querySelector('input');
        input.focus(); input.select();
      });
      await win.webContents.insertText(raw);
      await delay(50);
      assert.equal(await evaluate(() => document.activeElement.value), raw, 'The numeric regression must exercise the requested text');
      await evaluate(() => {
        const input = document.activeElement;
        // The hidden BrowserWindow does not emit native focusout consistently.
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        input.blur();
      });
      await delay(80); await click('[aria-label="Save project"]');
      return saved.paths[0].constraints.maxVel;
    };
    assert.equal(await enterVelocity('999'), saved.robot.maxSpeed, 'Typed velocity must respect its maximum');
    assert.equal(await enterVelocity('-5'), 0.1, 'Typed velocity must respect its minimum');
    for (const invalid of ['Infinity', 'NaN', '2oops', '']) {
      assert.equal(await enterVelocity(invalid), 0.1, 'Invalid numeric text must preserve the current value: ' + invalid);
    }
    assert.equal(await enterVelocity(String(maxVelocityBefore)), maxVelocityBefore);
    check('numeric text commits respect bounds and reject nonfinite, malformed, and empty values');
    await click('[aria-label="Sculpt path"]');
    const brushRadius = await evaluate(() => Number(document.querySelector('.brush-setting input').value));
    await evaluate(() => document.activeElement.blur());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ']' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ']' });
    await delay(80);
    assert.equal(await evaluate(() => Number(document.querySelector('.brush-setting input').value)), +(brushRadius + 0.1).toFixed(1));
    await click('[aria-label="Select / move"]');
    check('brush radius shortcut immediately follows the selected tool');
    const beforeNudge = structuredClone(saved.paths[0].waypoints[1]);
    await evaluate(() => { const row = document.querySelectorAll('.outline .featselect')[1]; row.click(); row.focus(); });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    await delay(80); await click('[aria-label="Save project"]');
    assert.ok(Math.abs(saved.paths[0].waypoints[1].x - beforeNudge.x - .05) < 1e-6);
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'nudge settles');
    await evaluate(() => document.querySelectorAll('.outline .featselect')[1].focus());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' });
    await delay(80); await click('[aria-label="Save project"]');
    assert.equal(saved.paths[0].waypoints.length, 2);
    await evaluate(() => document.querySelector('.outline .featselect').focus());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: ['control'] });
    await delay(80); await click('[aria-label="Save project"]');
    assert.equal(saved.paths[0].waypoints.length, 3);
    await evaluate(() => document.querySelector('.outline .featselect').focus());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: ['control'] });
    await delay(80); await click('[aria-label="Save project"]');
    assert.deepEqual(saved.paths[0].waypoints[1], beforeNudge);
    check('outline focus preserves arrow nudge, Delete, and undo shortcuts');
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'restored trajectory');
    const original = structuredClone(saved.paths[0].waypoints[1]);
    const point = await evaluate(() => { const r = document.querySelector('[data-role="wp"][data-idx="1"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await delay(50);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); await delay(50);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + 40, y: point.y + 20, button: 'left' }); await delay(120);
    await click('[data-library-item="library-path-1"]');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + 40, y: point.y + 20, button: 'left', clickCount: 1 });
    await click('[aria-label="Save project"]');
    assert.ok(Math.hypot(saved.paths[0].waypoints[1].x - original.x, saved.paths[0].waypoints[1].y - original.y) > .01);
    assert.deepEqual(saved.paths[1].waypoints[1], original);
    await click('[data-library-item="library-path-0"]');
    check('switching commits an active pointer edit without modifying the destination path');
    await pointerClick('[data-library-item="library-path-0"]');
    await pointerClick('[data-library-item="library-path-2"]', ['shift']);
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick[aria-pressed="true"]').length), 3, 'Shift-click selects the contiguous visible range');
    await pointerClick('[data-library-item="library-path-2"]', [process.platform === 'darwin' ? 'meta' : 'control']);
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick[aria-pressed="true"]').length), 2, 'Command/Control-click toggles one path without clearing the range');
    assert.equal(await evaluate(() => document.querySelectorAll('.library-row input[type="checkbox"]').length), 0);
    check('native Shift and Command/Control pointer selection works directly on rows without a selection mode');
    await input('.library-search', 'Opening');
    assert.match(await evaluate(() => document.querySelector('.library-selection').textContent), /2 paths selected.*hidden/);
    await click('.library-push > button');
    await wait(() => prepared.length === 1, 'captured scope');
    assert.deepEqual(prepared[0].scope, { kind: 'paths', pathIds: ['library-path-0', 'library-path-1'] });
    await wait(() => evaluate(() => document.querySelector('#robot-push-title')?.textContent === 'Review push'), 'review');
    await fs.writeFile(path.join(output, 'push-review.png'), (await win.webContents.capturePage()).toPNG());
    await click('.robot-push-dialog button', 'Push 2 paths');
    await wait(() => Boolean(finishPush), 'mock upload');
    await click('[aria-label="Close robot connection"]');
    await input('.library-search', 'Collect');
    await click('.library-pick');
    assert.equal(await evaluate(() => document.querySelector('.library-pick[aria-current="true"] .library-name').textContent), 'Collect second');
    assert.deepEqual(prepared[0].scope.pathIds, ['library-path-0', 'library-path-1']);
    await click('.library-connection');
    assert.match(await evaluate(() => document.querySelector('.robot-push-dialog').textContent), /Uploading/);
    finishPush({ state: 'active', revision: 'fixture-revision' });
    await wait(() => evaluate(() => document.querySelector('.robot-push-outcome')?.textContent.includes('Accepted by robot')), 'acceptance');
    await click('[aria-label="Close robot connection"]');
    check('hidden batch IDs stay fixed through review, upload, dismissal, and browsing');
    await click('.library-connection');
    await click('.robot-push-dialog button', 'Connection and history');
    await wait(() => evaluate(() => document.querySelector('[aria-label="Diagnostics"]')), 'diagnostics entry point');
    await click('[aria-label="Diagnostics"]');
    assert.equal(await evaluate(() => document.querySelector('dialog.robot-manager').open), false);
    assert.equal(await evaluate(() => document.querySelector('[aria-labelledby="beta-diagnostic-title"]').checkVisibility()), true);
    assert.equal(await evaluate(() => [...document.querySelectorAll('[aria-labelledby="beta-diagnostic-title"] button')].some((button) => button.textContent === 'Save bundle')), false);
    await click('[aria-labelledby="beta-diagnostic-title"] button', 'Generate preview');
    await wait(() => diagnosticPreviews.length === 1, 'local diagnostic preview');
    assert.equal(diagnosticPreviews[0].name, 'Library verification');
    const previewText = await evaluate(() => { const input = document.querySelector('[aria-label="Read-only beta diagnostic JSON"]'); return { contents: input.value, readOnly: input.readOnly }; });
    assert.equal(previewText.readOnly, true);
    assert.equal(JSON.parse(previewText.contents).project, 'Library verification');
    await click('[aria-labelledby="beta-diagnostic-title"] button', 'Save bundle');
    await wait(() => diagnosticSaves.length === 1, 'save preview capability');
    assert.equal(diagnosticSaves[0], 'fixture-preview-capability');
    assert.match(await evaluate(() => document.querySelector('[aria-labelledby="beta-diagnostic-title"]').textContent), /Diagnostic bundle saved/);
    await click('[aria-label="Close diagnostic bundle"]');
    check('connection opens usable diagnostics, then previews read-only bytes and saves the capability');
    await input('.library-search', '');
    await pointerClick('[data-library-item="library-path-0"]');
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick[aria-pressed="true"]').length), 1, 'Plain click returns to one selected path');
    assert.equal(await evaluate(() => document.querySelector('.library-push > button').textContent.trim()), 'Push path');
    assert.equal(await evaluate(() => [...document.querySelectorAll('.library-tools button')].some((button) => ['Select', 'Done'].includes(button.textContent.trim()))), false);
    check('plain row click replaces a batch with the current path and there is no Select mode');
    await click('[aria-label="Actions for Opening move"]');
    await click('.library-menu button', 'Delete');
    assert.match(await evaluate(() => document.querySelector('.library-blocked').textContent), /Routine A/);
    await click('.library-blocked button');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Routine A');
    check('referenced deletion explains and opens its routine');
    await click('.library-tools button', 'New routine');
    await input('.library-rename input', 'Fresh routine');
    await click('[aria-label="Save name"]');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Fresh routine');
    assert.equal(await evaluate(() => document.querySelector('.routine-workspace-flow .rt-empty').checkVisibility()), true, 'New routine starts in the central flow empty state');
    assert.ok(await evaluate(() => document.activeElement.matches('.library-pick')));
    await click('[aria-label="Save project"]');
    assert.ok(saved.routines.some((routine) => routine.name === 'Fresh routine'));
    await click('.pageswitch button', 'Settings'); await click('.pageswitch button', 'Editor');
    assert.equal(await evaluate(() => document.querySelector('.library-tabs [aria-selected="true"]').textContent), 'Routines');
    check('inline naming restores focus; Save and return-to-editor retain routine mode');
    await click('.library-tabs button', 'Paths');
    await input('.library-search', 'no matches');
    assert.match(await evaluate(() => document.querySelector('.library-empty').textContent), /No matching names/);
    await click('.library-tabs button', 'Routines'); await click('.library-tabs button', 'Paths');
    assert.equal(await evaluate(() => document.querySelector('.library-search').value), 'no matches');
    await input('.library-search', '');
    await evaluate(() => document.querySelector('.library-divider').focus());
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' }); await delay(60);
    assert.equal(await evaluate(() => document.querySelector('.library-divider').getAttribute('aria-valuenow')), '53');
    check('search persists per tab and divider works from the keyboard');
    await click('[aria-label="New folder"]');
    await input('.library-rename input', 'Practice'); await click('[aria-label="Save name"]');
    await click('.library-tools button', 'New path');
    await input('.library-rename input', 'Managed path'); await click('[aria-label="Save name"]');
    await pointerClick('[data-library-item="library-path-0"]', ['shift']);
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick[aria-pressed="true"]').length), await evaluate(() => document.querySelectorAll('.library-pick').length), 'Newly created active path anchors the next range selection');
    await pointerClick('.library-pick[aria-current="true"]');
    check('creating a path makes it the anchor for the next Shift range');
    await click('[aria-label="Actions for Managed path"]'); await click('.library-menu button', 'Duplicate');
    await click('[aria-label="Save name"]');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Managed path copy');
    await click('[aria-label="Actions for Managed path copy"]');
    await click('.library-menu button', 'Folder and links…');
    await evaluate(() => {
      const select = document.querySelector('.library-properties select');
      select.value = [...select.options].find((option) => option.text === 'Practice').value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await delay(60); await click('[aria-label="Save project"]');
    const managed = saved.paths.find((item) => item.name === 'Managed path copy');
    assert.ok(managed.id !== saved.paths.find((item) => item.name === 'Managed path').id);
    assert.equal(managed.folderId, saved.pathFolders.find((folder) => folder.name === 'Practice').id);
    await click('[aria-label="Close path properties"]');
    await click('[aria-label="Actions for Managed path copy"]');
    await click('.library-menu button', 'Append path'); await click('[aria-label="Save name"]');
    await click('[aria-label="Save project"]');
    assert.ok(saved.pathLinks.some((link) => link.fromPathId === managed.id));
    await evaluate(() => { window.confirm = () => true; });
    await click('[aria-label="Actions for folder Practice"]'); await click('.library-menu button', 'Delete folder');
    await click('[aria-label="Save project"]');
    assert.ok(!saved.pathFolders.some((folder) => folder.name === 'Practice'));
    assert.ok(!saved.paths.find((item) => item.id === managed.id).folderId);
    await click('[aria-label="Actions for Managed path"]'); await click('.library-menu button', 'Delete');
    await click('[aria-label="Save project"]');
    assert.ok(!saved.paths.some((item) => item.name === 'Managed path'));
    check('create, duplicate, move, append/link, folder deletion, and path deletion preserve data');
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
    const dragRoutine = async (from, to, valid) => {
      const points = await evaluate((from, to) => {
        const grip = document.querySelector(`[data-id="${from}"] .rt-grip`), target = document.querySelector(`[data-id="${to}"] .rt-step-body`);
        grip.scrollIntoView({ block: 'nearest' });
        const a = grip.getBoundingClientRect(), b = target.getBoundingClientRect();
        return { a: { x: Math.round(a.x+a.width/2), y: Math.round(a.y+a.height/2) }, b: { x: Math.round(b.x+b.width/2), y: Math.round(b.bottom-3) } };
      }, from, to);
      win.webContents.sendInputEvent({ type: 'mouseDown', ...points.a, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...points.b, button: 'left' }); await delay(100);
      assert.equal(await evaluate(() => Boolean(document.querySelector('.drop-before,.drop-after'))), valid, 'Drop feedback must match supported sibling moves');
      win.webContents.sendInputEvent({ type: 'mouseUp', ...points.b, button: 'left', clickCount: 1 });
      await delay(100); await click('[aria-label="Save project"]');
    };
    const routineBeforeDrag = structuredClone(saved.routines.find((r) => r.id === 'routine-a'));
    await dragRoutine('step-a', 'step-then', false);
    assert.deepEqual(saved.routines.find((r) => r.id === 'routine-a'), routineBeforeDrag);
    await dragRoutine('step-a', 'step-finish', true);
    assert.equal(saved.routines.find((r) => r.id === 'routine-a').nodes.at(-1).id, 'step-a');
    await click('[title^="Undo"]'); await click('[aria-label="Save project"]');
    assert.deepEqual(saved.routines.find((r) => r.id === 'routine-a'), routineBeforeDrag);
    await click('.library-tabs button', 'Paths');
    check('native routine drag rejects cross-branch moves and commits supported sibling moves');
    for (const [width, height] of [[1440, 900], [1280, 800], [1100, 720]]) {
      win.setContentSize(width, height); await delay(150);
      const geometry = await evaluate(() => {

        const rail = document.querySelector('.library-rail');
        return { sharedPositions: ['.pageswitch', '[aria-label=\"Save project\"]'].map((selector) => document.querySelector(selector).getBoundingClientRect().x), overflow: document.documentElement.scrollWidth > innerWidth, fieldWidth: document.querySelector('.fieldcol').getBoundingClientRect().width, railWidth: rail.getBoundingClientRect().width, pushVisible: document.querySelector('.library-push > button').checkVisibility() };
      });
      assert.equal(geometry.overflow, false); assert.ok(geometry.fieldWidth >= 350); assert.equal(geometry.pushVisible, true);
      assert.equal(geometry.railWidth, 264, 'Library width remains fixed across supported sizes');

      await evaluate(() => document.querySelector('.library-divider').focus()); await key('Home');
      assert.equal(await evaluate(() => { const button = document.querySelector('.library-push > button').getBoundingClientRect(), section = document.querySelector('.library-top').getBoundingClientRect(); return button.bottom <= section.bottom; }), true, 'Push remains reachable at the minimum library height');
      await pointerClick('[data-library-item="library-path-0"]');
      await pointerClick('[data-library-item="library-path-1"]', [process.platform === 'darwin' ? 'meta' : 'control']);
      assert.equal(await evaluate(() => document.querySelector('.library-push > button').checkVisibility()), true);
      await evaluate(() => document.querySelector('.library-divider').focus()); await key('End');
      for (let index = 0; index < 5; index++) await key('Up');
      await fs.writeFile(path.join(output, `paths-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
      const flowGeometry = await evaluate(() => {
        const flow = document.querySelector('.routine-workspace-flow'), stage = document.querySelector('.stage-auto');
        return { sharedPositions: ['.pageswitch', '[aria-label=\"Save project\"]'].map((selector) => document.querySelector(selector).getBoundingClientRect().x), width: flow.getBoundingClientRect().width, height: flow.getBoundingClientRect().height, stageHeight: stage.getBoundingClientRect().height, railWidth: document.querySelector('.library-rail').getBoundingClientRect().width, inRail: Boolean(flow.closest('.library-rail')), flowInRail: Boolean(document.querySelector('.library-rail .rt-panel')), overflow: document.documentElement.scrollWidth > innerWidth, contentOverflow: flow.querySelector('.rt-scroll').scrollWidth > flow.querySelector('.rt-scroll').clientWidth };
      });
      assert.equal(flowGeometry.railWidth, geometry.railWidth);
      assert.deepEqual(flowGeometry.sharedPositions, geometry.sharedPositions, 'Shared toolbar actions stay anchored when switching to routines at ' + width);
      assert.equal(flowGeometry.inRail, false); assert.equal(flowGeometry.flowInRail, false);
      assert.ok(flowGeometry.width > width * .6, 'Unselected routine flow gets most screen width at ' + width);
      assert.ok(flowGeometry.height > flowGeometry.stageHeight * .7, 'Routine flow gets most workspace height');
      assert.equal(flowGeometry.overflow, false); assert.equal(flowGeometry.contentOverflow, false);
      await delay(500);
      await fs.writeFile(path.join(output, `routines-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('.rt-step[data-id="step-then"] .rt-step-body');
      assert.equal(await evaluate(() => document.querySelector('[aria-label="Routine step inspector"]').checkVisibility()), true);
      assert.equal(await evaluate(() => { const el = document.querySelector('.rt-scroll'); return el.scrollWidth > el.clientWidth; }), false, 'Populated branch flow must not clip when the inspector opens');
      await fs.writeFile(path.join(output, `routine-inspector-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('[aria-label="Routine view"] button', 'Field preview');
      assert.equal(await evaluate(() => document.querySelector('.routine-workspace-field').checkVisibility()), true);
      assert.equal(await evaluate(() => document.querySelector('.routine-workspace-flow').checkVisibility()), false);
      await click('[aria-label="Routine view"] button', 'Flow');
      assert.equal(await evaluate(() => document.querySelector('.rt-step[data-id="step-then"] .rt-step-body').getAttribute('aria-pressed')), 'true');
      assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Routine A');
      if (width === 1440) {
        await click('.rail-r button', 'Open in path editor');
        assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Collect second');
        assert.deepEqual(await evaluate(() => [...document.querySelectorAll('.library-pick[aria-pressed="true"]')].map((item) => item.dataset.libraryItem)), ['library-path-1'], 'Opening a routine step path must replace the prior saved batch');
        await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
        await click('.rt-step[data-id="step-then"] .rt-step-body');
      }
      await click('[aria-label="Close step inspector"]');
      await click('.library-tabs button', 'Paths');
    }
    check('200-item library keeps fixed width; populated flow owns central workspace at three desktop sizes and preserves selection across preview');
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
    await click('.rt-branches .rt-add');
    const branchBefore = saved.routines.find((routine) => routine.id === 'routine-a').nodes.find((node) => node.id === 'decision-a').then.length;
    await evaluate(() => [...document.querySelectorAll('.rt-branches .rt-ch-row')].find((button) => button.querySelector('.rt-ch-t').textContent === 'Path').click());
    await delay(80); await click('[aria-label="Save project"]');
    assert.equal(saved.routines.find((routine) => routine.id === 'routine-a').nodes.find((node) => node.id === 'decision-a').then.length, branchBefore + 1);
    assert.ok(await evaluate(() => Boolean(document.querySelector('.rt-branches .rt-step.sel'))));
    check('adding a path in a populated decision branch selects the new step in the main flow');
    await click('.library-tabs button', 'Paths');
    deferInspection = true;
    await click('.library-connection');
    await wait(() => Boolean(finishInspection), 'pending robot inspection');
    await click('.robot-push-dialog button', 'Pair another robot');
    await click('.robot-push-dialog button', 'Connect');
    await click('.robot-push-dialog button', 'Trust and pair');
    assert.equal(await evaluate(() => [...document.querySelectorAll('.robot-push-dialog button')].some((button) => button.textContent === 'Refresh robot' && !button.disabled)), true, 'A superseded inspection must not leave the replacement pairing stuck refreshing');
    deferInspection = false;
    finishInspection(inspection());
    await click('.robot-push-dialog button', 'Refresh robot');
    await wait(() => evaluate(() => [...document.querySelectorAll('.robot-push-dialog button')].some((button) => button.textContent === 'Refresh robot' && !button.disabled)), 'replacement robot inspection');
    await click('[aria-label="Close robot connection"]');
    check('pairing another robot during inspection leaves its refresh control usable');
    await click('.library-connection');
    await click('.robot-push-dialog button', 'Pair another robot');
    await wait(() => evaluate(() => document.querySelector('.robot-push-endpoint')), 'unpaired connection surface');
    assert.equal(await evaluate(() => document.querySelector('.library-connection').textContent.trim()), 'Connect robot');
    assert.equal(await evaluate(() => { const button = document.querySelector('.library-connection'); return button.scrollWidth <= button.clientWidth; }), true);
    assert.equal(await evaluate(() => document.querySelectorAll('.robot-connection-diagnostics').length), 1);
    await wait(() => evaluate(() => document.querySelector('[aria-label="Diagnostics"]')?.checkVisibility()), 'unpaired diagnostics control');
    await click('[aria-label="Diagnostics"]');
    assert.equal(await evaluate(() => document.querySelector('dialog.robot-manager').open), false);
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close diagnostic bundle');
    await click('[aria-labelledby="beta-diagnostic-title"] button', 'Generate preview');
    await wait(() => diagnosticPreviews.length === 2, 'unpaired diagnostic preview');
    await click('[aria-labelledby="beta-diagnostic-title"] button', 'Save bundle');
    await wait(() => diagnosticSaves.length === 2, 'unpaired local diagnostic save');
    await click('[aria-label="Close diagnostic bundle"]');
    assert.equal(prepared.length, 1, 'Diagnostics must not initiate another robot push');
    check('unpaired connection keeps diagnostics reachable, focused, and locally saveable');

    saved = { ...saved, name: 'Simple library', paths: saved.paths.slice(0, 2).map((item) => ({ ...item, folderId: undefined })), pathFolders: [], pathLinks: [], editor: { ...saved.editor, activePathId: 'library-path-0' }, activeRoutineId: 'routine-a' };
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-current-name')?.textContent === 'Opening move'), 'simple restored library');
    assert.equal(await evaluate(() => document.querySelectorAll('.library-pick').length), 2);
    await click('.pageswitch button', 'Settings');
    await click('[aria-label="Display units"] button', 'Imperial');
    await click('.pageswitch button', 'Editor');
    await wait(() => evaluate(() => !!document.querySelector('.wpfeatrow .featmeta')), 'Imperial waypoint coordinates');
    assert.equal(await evaluate(() => document.querySelector('.wpfeatrow .featmeta').textContent), `${(saved.paths[0].waypoints[0].x / .3048).toFixed(1)}, ${(saved.paths[0].waypoints[0].y / .3048).toFixed(1)} ft`);
    await click('.pageswitch button', 'Settings');
    await click('[aria-label="Display units"] button', 'Metric');
    await click('.pageswitch button', 'Editor');
    check('waypoint outline coordinates use the selected unit system');

    assert.equal(await evaluate(() => document.querySelectorAll('.library-folder').length), 0, 'Root paths must not be wrapped in a synthetic Unfiled folder');
    assert.equal(await evaluate(() => document.querySelectorAll('.library-row input[type="checkbox"]').length), 0);
    assert.equal(await evaluate(() => document.querySelector('.editor-library').textContent.includes('Unfiled')), false);
    await click('[aria-label="Actions for Opening move"]');
    assert.equal(await evaluate(() => document.querySelector('.library-menu').matches(':popover-open')), true, 'Actions use a native popover above the list');
    assert.equal(await evaluate(() => document.querySelector('.library-menu [role="menuitem"]').textContent), 'Rename');
    await key('End');
    assert.equal(await evaluate(() => document.activeElement.textContent), 'Delete');
    await key('Escape');
    assert.equal(await evaluate(() => document.querySelector('.library-menu')), null);
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Actions for Opening move');
    await click('[aria-label="Actions for Opening move"]');
    await pointerClick('.fieldcol');
    assert.equal(await evaluate(() => document.querySelector('.library-menu')), null, 'Click outside in the field dismisses the menu');
    await click('[aria-label="Actions for Opening move"]');
    await click('.library-menu button', 'Folder and links…');
    assert.equal(await evaluate(() => document.querySelector('.library-properties').open), true);
    assert.equal(await evaluate(() => document.querySelector('.library-properties select option[value=""]').textContent), 'No folder');
    await key('Escape');
    assert.equal(await evaluate(() => document.querySelector('.library-properties')), null);
    assert.equal(await evaluate(() => document.activeElement.dataset.libraryItem), 'library-path-0');
    check('item popover supports keyboard, Escape focus restoration, outside dismissal, and separate native properties');
    for (const [width, height] of [[1440, 900], [1280, 800], [1100, 720]]) {
      win.setContentSize(width, height); await delay(150);
      await pointerClick('[data-library-item="library-path-0"]');
      const rows = await evaluate(() => [...document.querySelectorAll('.library-row')].map((el) => ({ height: el.getBoundingClientRect().height, borderRadius: getComputedStyle(el).borderRadius, shadow: getComputedStyle(el).boxShadow })));
      assert.ok(rows.every((row) => row.height <= 34 && row.borderRadius === '0px' && row.shadow === 'none'), 'Paths must be flat compact rows: ' + JSON.stringify(rows));
      await fs.writeFile(path.join(output, `simple-paths-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await pointerClick('[data-library-item="library-path-1"]', [process.platform === 'darwin' ? 'meta' : 'control']);
      await fs.writeFile(path.join(output, `simple-multiselect-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await pointerClick('[data-library-item="library-path-0"]', [process.platform === 'darwin' ? 'meta' : 'control']);
      assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Collect second', 'Single-item push label follows selected ID even when editor stays on another path');
      await click('[aria-label="Actions for Opening move"]');
      await fs.writeFile(path.join(output, `simple-menu-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await key('Escape');
      await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
      if (await evaluate(() => Boolean(document.querySelector('[aria-label="Close step inspector"]')))) await click('[aria-label="Close step inspector"]');
      await delay(500);
      await fs.writeFile(path.join(output, `simple-routines-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Paths');
    }
    check('two root paths use flat rows, direct modifier selection, accurate scoped push names, and uncluttered item popovers');
    // Exercise simultaneous notices with the application's real CSS at narrow field widths.
    for (const width of [320, 600]) {
      const layout = await evaluate((width) => {
        const field = document.querySelector('.stage-plan .fieldcol');
        const original = field.querySelector('.field-notices');
        const fixture = original.cloneNode(false);
        fixture.innerHTML = '<div class="field-status"><details><summary><span class="field-status-label">Preparing trajectory…</span><span class="field-status-disclosure">Details (3)</span></summary><div class="field-status-details"><div class="field-status-item"><strong>Optimization out of date</strong><p>' + 'Long diagnostic text '.repeat(100) + '</p><button>Optimize</button></div></div></details><button class="field-status-action">Optimize</button></div>'
          + '<div class="insert-preview"><div class="insert-preview-copy"><b>Preview waypoint</b><span>Insert the waypoint at the previewed location.</span></div><div class="insert-preview-actions"><button>Cancel</button><button>Insert waypoint</button></div></div>';
        const previous = field.style.flex;
        field.style.flex = '0 0 ' + width + 'px';
        original.style.visibility = 'hidden';
        field.append(fixture);
        const rects = [...fixture.children].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
        const button = fixture.querySelector('.field-status-action'), r = button.getBoundingClientRect();
        const statusHeight = fixture.firstElementChild.getBoundingClientRect().height;
        const fonts = [fixture.querySelector('summary'), button].map((el) => getComputedStyle(el).fontSize);
        fixture.querySelector('details').open = true;
        const detail = fixture.querySelector('.field-status-details');
        const detailHeight = detail.getBoundingClientRect().height;
        const bounded = detail.scrollHeight > detail.clientHeight;
        fixture.querySelector('details').open = false;
        const result = { statusHeight, fonts, detailHeight, bounded, rects, bounds: field.getBoundingClientRect().toJSON(), clickable: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === button };
        fixture.remove(); original.style.visibility = ''; field.style.flex = previous;
        return result;
      }, width);
      assert.ok(layout.statusHeight <= 40, 'Status remains one compact row');
      assert.equal(layout.fonts[0], layout.fonts[1], 'Status and action use consistent font sizes');
      assert.ok(layout.detailHeight <= 240 && layout.bounded, 'Long diagnostics scroll in a bounded disclosure');
      layout.rects.forEach((rect, index) => {
        if (index) assert.ok(rect.top >= layout.rects[index - 1].bottom + 5, 'Simultaneous field notices must have separate rows');
        assert.ok(rect.left >= layout.bounds.left && rect.right <= layout.bounds.right, 'Field notices must wrap within the field');
      });
      assert.equal(layout.clickable, true, 'Review trajectory must remain clickable');
    }
    check('simultaneous passive statuses occupy one consistent-size row with bounded diagnostic details');
    saved = { ...saved, name: 'Shared waypoint verification', paths: [...saved.paths, { ...structuredClone(saved.paths[0]), id: 'unlinked-path', name: 'Independent path' }].map((path, index) => ({ ...path, headingMode: 'tangent', startVel: .4, goalVel: .6, waypoints: path.waypoints.map((waypoint, at) => ({ ...waypoint, theta: index === 0 ? 15 : 130, thetaOn: true, stop: false })) })) };
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-current-name')?.textContent === 'Opening move' && !document.querySelector('.fieldcol[inert]')), 'shared waypoint fixture ready');
    const saveCurrent = async () => { await click('[aria-label="Save project"]'); };
    const editNumber = async (label, value) => {
      await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'editable ' + label);
      await evaluate((label) => {
        const field = [...document.querySelectorAll('.numrow')].find((row) => row.querySelector('label')?.textContent === label)?.querySelector('input');
        if (!field || field.matches(':disabled')) throw new Error('Numeric field unavailable: ' + label);
        field.focus(); field.select();
      }, label);
      await win.webContents.insertText(String(value)); await delay(50);
      await evaluate(() => { const field = document.activeElement; field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); field.blur(); });
      await delay(80); await saveCurrent();
    };
    const numericState = (label) => evaluate((label) => { const field = [...document.querySelectorAll('.numrow')].find((row) => row.querySelector('label')?.textContent === label)?.querySelector('input'); return field ? { value: Number(field.value), disabled: field.matches(':disabled') } : null; }, label);
    await click('.cbar');
    assert.deepEqual(await numericState('Entry speed (vi)'), { value: .4, disabled: false });
    assert.deepEqual(await numericState('Exit speed (vf)'), { value: .6, disabled: false });
    const facingBaseline = structuredClone(saved.paths[0].waypoints[0]);
    const headPoint = await evaluate(() => {
      const handle = document.querySelector('circle[data-role="head"][data-idx="0"]');
      if (!handle) throw new Error('Start facing handle missing in tangent mode');
      const rect = handle.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...headPoint });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...headPoint, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: headPoint.x + 20, y: headPoint.y + 25 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: headPoint.x + 20, y: headPoint.y + 25, button: 'left', clickCount: 1 });
    await delay(100); await saveCurrent();
    assert.equal(saved.paths[0].waypoints[0].segmentHeadingMode, 'manual', 'Dragging start facing overrides tangent heading');
    assert.deepEqual(saved.paths[0].waypoints[0].prevC, facingBaseline.prevC);
    assert.deepEqual(saved.paths[0].waypoints[0].nextC, facingBaseline.nextC);
    assert.equal(saved.paths[0].waypoints[0].x, facingBaseline.x);
    assert.equal(saved.paths[0].waypoints[0].y, facingBaseline.y);
    await click('.cbar');

    await editNumber('Initial robot facing', 42);
    assert.equal(saved.paths[0].waypoints[0].theta, 42);
    assert.deepEqual(saved.paths[0].waypoints[0].prevC, facingBaseline.prevC);
    assert.deepEqual(saved.paths[0].waypoints[0].nextC, facingBaseline.nextC);
    await editNumber('Entry speed (vi)', .5); await editNumber('Exit speed (vf)', .7);
    assert.equal(saved.paths[0].startVel, .5); assert.equal(saved.paths[0].goalVel, .7);
    for (const [index, toggle, label, speed] of [[0, 'Stop at entry', 'Entry speed (vi)', .5], [saved.paths[0].waypoints.length - 1, 'Stop at exit', 'Exit speed (vf)', .7]]) {
      await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'endpoint ready');
      await evaluate((index) => document.querySelectorAll('.outline .featselect')[index].click(), index);
      await click('[aria-label="' + toggle + '"]'); await saveCurrent();
      assert.equal(saved.paths[0].waypoints[index].stop, true);
      await click('.cbar');
      assert.deepEqual(await numericState(label), { value: 0, disabled: true }, 'Stopped endpoints display effective zero speed');
      await evaluate((index) => document.querySelectorAll('.outline .featselect')[index].click(), index);
      await click('[aria-label="' + toggle + '"]'); await saveCurrent();
      await click('.cbar');
      assert.deepEqual(await numericState(label), { value: speed, disabled: false }, 'Removing the stop restores the stored endpoint speed');
    }
    check('summary facing changes preserve tangents; vi/vf edit independently and endpoint stops show effective zero');
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'waypoint link inspector ready');
    await evaluate(() => document.querySelector('.outline .featselect').click());
    const independentBefore = structuredClone(saved.paths[2]);
    const linkBaseline = saved.paths.slice(0, 2).map((path) => structuredClone(path.waypoints[0]));
    assert.equal(await evaluate(() => document.querySelector('#waypoint-position-link').disabled), true, 'Ordinary waypoints are absent from the picker');
    await evaluate((id) => document.querySelector('[data-library-item="' + id + '"]').click(), saved.paths[1].id);
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'target point ready');
    await evaluate(() => document.querySelector('.outline .featselect').click());
    await click('[aria-label="Linkable waypoint"]');
    await wait(() => evaluate(() => document.querySelector('[aria-label="Linkable point name"]') && !document.querySelector('.rail-r[inert]')), 'named point editable');
    await evaluate(() => { const input = document.querySelector('[aria-label="Linkable point name"]'); input.focus(); input.select(); });
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Linkable point name');
    await win.webContents.insertText('Scoring position'); await delay(80);
    await evaluate(() => { const input = document.querySelector('[aria-label="Linkable point name"]'); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); input.blur(); });
    await delay(80);
    await saveCurrent();
    assert.equal(saved.paths[1].waypoints[0].positionName, 'Scoring position', 'Named point saved from actual typing');
    linkBaseline[1] = structuredClone(saved.paths[1].waypoints[0]);
    await evaluate((id) => document.querySelector('[data-library-item="' + id + '"]').click(), saved.paths[0].id);
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'source point ready');
    await evaluate(() => document.querySelector('.outline .featselect').click());
    await click('#waypoint-position-link');
    assert.equal(await evaluate(() => document.querySelectorAll('.cmd-picker-option').length), 1, 'Only the opted-in named point is offered');
    await evaluate(() => [...document.querySelectorAll('.cmd-picker-option')].find((el) => el.querySelector('strong')?.textContent === 'Scoring position').click());
    await saveCurrent();
    const linkId = saved.paths[0].waypoints[0].positionLink;
    assert.ok(linkId); assert.equal(saved.paths[1].waypoints[0].positionLink, linkId);
    assert.equal(saved.paths[0].waypoints[0].x, saved.paths[1].waypoints[0].x);
    assert.equal(saved.paths[0].waypoints[0].y, saved.paths[1].waypoints[0].y);
    assert.equal(saved.paths[0].waypoints[0].theta, 42); assert.equal(saved.paths[1].waypoints[0].theta, 130);
    const linkedBeforeEdit = saved.paths.slice(0, 2).map((path) => structuredClone(path.waypoints[0]));
    const newX = Math.round((saved.paths[0].waypoints[0].x + .25) * 100) / 100;
    await editNumber('X', newX);
    for (const [index, path] of saved.paths.slice(0, 2).entries()) {
      const point = path.waypoints[0], before = linkedBeforeEdit[index];
      assert.equal(point.x, newX); assert.equal(point.theta, before.theta);
      for (const handle of ['prevC', 'nextC']) {
        assert.ok(Math.abs((point[handle].x - point.x) - (before[handle].x - before.x)) < 1e-8, 'Shared movement preserves each local tangent vector');
        assert.ok(Math.abs((point[handle].y - point.y) - (before[handle].y - before.y)) < 1e-8);
      }
    }
    await click('[title^="Undo"]'); await saveCurrent();
    assert.deepEqual(saved.paths.slice(0, 2).map((path) => path.waypoints[0]), linkedBeforeEdit, 'Undo coordinates restores both linked members');
    await click('[title^="Undo"]'); await saveCurrent();
    assert.deepEqual(saved.paths.slice(0, 2).map((path) => path.waypoints[0]), linkBaseline, 'Undo link restores the full project before joining');
    await click('[title^="Redo"]'); await saveCurrent();
    assert.deepEqual(saved.paths.slice(0, 2).map((path) => path.waypoints[0]), linkedBeforeEdit, 'Redo link restores both members');
    await click('[title^="Redo"]'); await saveCurrent();
    assert.ok(saved.paths.slice(0, 2).every((path) => path.waypoints[0].x === newX && path.waypoints[0].positionLink === linkId));
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'unlink ready');
    await fs.writeFile(path.join(output, 'linked-position-inspector.png'), (await win.webContents.capturePage()).toPNG());
    await click('.shared-waypoint-position button', 'Unlink'); await saveCurrent();
    assert.equal(saved.paths[0].waypoints[0].positionLink, undefined);
    const independentX = Math.round((newX + .2) * 100) / 100;
    await editNumber('X', independentX);
    assert.equal(saved.paths[0].waypoints[0].x, independentX); assert.equal(saved.paths[1].waypoints[0].x, newX);
    assert.equal(saved.paths[1].waypoints[0].theta, 130);
    assert.deepEqual(saved.paths[2], independentBefore, 'Unrelated path remains unchanged');
    await fs.writeFile(path.join(output, 'shared-position-inspector.png'), (await win.webContents.capturePage()).toPNG());
    check('searchable shared position links propagate coordinates only, support project undo/redo, and unlink cleanly');
    await evaluate(() => {
      window.__routinePendingCheck = { samples: 0, violations: [] };
      window.__routinePendingObserver = new MutationObserver(() => {
        if (!document.querySelector('.routine-status.planning')) return;
        window.__routinePendingCheck.samples++;
        const skipped = [...document.querySelectorAll('.rt-step-meta')].filter((element) => element.textContent.includes('Skipped in this preview') && !element.closest('.rt-branch:not(.live)'));
        if (skipped.length) window.__routinePendingCheck.violations.push(skipped.map((element) => element.textContent));
      });
      window.__routinePendingObserver.observe(document.querySelector('#root'), { subtree: true, childList: true, characterData: true });
    });
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
    await wait(() => evaluate(() => !document.querySelector('.routine-status.planning')), 'routine planning settles');
    const pending = await evaluate(() => { window.__routinePendingObserver.disconnect(); return window.__routinePendingCheck; });
    assert.ok(pending.samples > 0, 'Regression must observe an actual pending routine render');
    assert.deepEqual(pending.violations, [], 'Pending preview-included routine nodes must not flash skipped status');
    check('actual pending routine renders never label included paths as skipped before planning settles');
    // Restoring a project calculates the unopened path, without selecting it.
    saved = { ...saved, pathLinks: [], routines: [], activeRoutineId: '', paths: saved.paths.slice(0, 2).map((path, index) => ({
      ...path, optimization: undefined, headingMode: 'manual', driveBackward: false, startVel: 0, goalVel: 0,
      markers: [], targets: [], ranges: [], waypoints: [2, 4 + index * 2].map((x) => ({
        x, y: 3, theta: 0, thetaOn: true, linked: true, stop: false, segType: 'line',
        prevC: { x: x - .5, y: 3 }, nextC: { x: x + .5, y: 3 },
      })),
    })) };
    saved.editor = { activePathId: saved.paths[0].id };
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => {
      const labels = [...document.querySelectorAll('.library-meta')];
      return labels.length === 2 && labels.every((label) => /^\d+\.\d{2} s$/.test(label.textContent));
    }), 'restored unopened path durations');
    const durationLayout = await evaluate(() => [...document.querySelectorAll('.library-row')].map((row) => {
      const name = row.querySelector('.library-name'), time = row.querySelector('.library-meta');
      const center = (element) => { const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2; };
      return { row: center(row), name: center(name), time: center(time), seconds: parseFloat(time.textContent) };
    }));
    for (const layout of durationLayout) {
      assert.ok(Math.abs(layout.time - layout.row - 1) < .1, 'Duration uses the optical centering offset within its row');
      assert.ok(Math.abs(layout.name - layout.time) < .1, 'Name and duration share the same vertical center');
    }
    assert.ok(durationLayout[1].seconds > durationLayout[0].seconds, 'Unopened longer path has its own calculated time');
    assert.equal(await evaluate(() => document.querySelector('.library-pick[aria-current="true"]').dataset.libraryItem), saved.paths[0].id);
    await fs.writeFile(path.join(output, 'restored-path-durations.png'), (await win.webContents.capturePage()).toPNG());
    check('unopened paths receive current trajectory times after restore, with vertically centered names and durations');
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'fault injection baseline ready');
    const beforeFailure = structuredClone(saved.paths[0]);
    await evaluate((pathId) => {
      const post = Worker.prototype.postMessage;
      window.__restoreWorkerPost = () => { Worker.prototype.postMessage = post; delete window.__restoreWorkerPost; };
      Worker.prototype.postMessage = function (message, ...args) {
        if (message.quality === 'interactive' && message.path.id === pathId && message.path.waypoints[0].x === 2.25) {
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: { message: 'Injected interactive planning failure' } } })), 0);
          return;
        }
        return post.call(this, message, ...args);
      };
    }, saved.paths[0].id);
    await click('.wpfeatrow .featselect');
    await editNumber('X', 2.25);
    await click('.optimizer-toggle');
    await wait(() => evaluate(() => document.querySelector('.optimizer-failure')?.textContent.includes('Injected interactive planning failure')), 'current error shown over retained preview');
    assert.equal(await evaluate(() => Boolean(document.querySelector('.fieldcol[inert]'))), true, 'Stale geometry must stay inert');
    assert.equal(await evaluate(() => Boolean(document.querySelector('.optimizer-panel').closest('[inert]'))), false, 'Error recovery must remain usable');
    assert.equal(await evaluate(() => document.querySelector('.optimizer-main').textContent), 'Undo last edit');
    await fs.writeFile(path.join(output, 'optimizer-interactive-failure.png'), (await win.webContents.capturePage()).toPNG());
    await click('.optimizer-main');
    await wait(() => evaluate(() => !document.querySelector('.optimizer-failure') && !document.querySelector('.fieldcol[inert]')), 'Undo recovers planning');
    await evaluate(() => window.__restoreWorkerPost());
    await click('[aria-label="Save project"]');
    assert.deepEqual(saved.paths[0].waypoints, beforeFailure.waypoints);
    await click('.optimizer-toggle');
    check('interactive planning failure retains the preview, exposes the current error, and recovers through Undo');

    saved.paths[0] = { ...structuredClone(source), id: saved.paths[0].id, name: 'Collect the second game piece from the far loading station' };
    saved.paths[0].waypoints[1] = { ...saved.paths[0].waypoints[1], thetaOn: true, theta: -178, stop: true, wait: 12.5 };
    saved.routines = [{ id: 'long-flow', name: 'Long content check', nodes: [{ id: 'long-step', type: 'path', ref: saved.paths[0].id }] }];
    saved.activeRoutineId = 'long-flow';
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]') && document.querySelectorAll('.wpfeatrow').length === 3), 'badge-rich waypoint fixture');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(100);
      const waypointLayout = await evaluate(() => { const row = document.querySelectorAll('.wpfeatrow')[1], name = row.querySelector('.featnm'), details = row.querySelector('.featdetails'); return { name: name.textContent, fits: name.scrollWidth <= name.clientWidth, separated: details.getBoundingClientRect().top >= name.getBoundingClientRect().bottom, detailsFit: details.scrollWidth <= details.clientWidth }; });
      assert.deepEqual(waypointLayout, { name: 'Waypoint 1', fits: true, separated: true, detailsFit: true });
      assert.equal(await evaluate(() => ['.library-name', '.library-current-name', '.ctxinsp-t'].every((selector) => { const el = document.querySelector(selector); return el.scrollWidth <= el.clientWidth && getComputedStyle(el).whiteSpace === 'normal'; })), true, 'Primary path names stay readable across library and inspector');
      await fs.writeFile(path.join(output, `waypoint-badges-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Routines');
      await click('.rt-step-body');
      const beforeHover = await evaluate(() => { const el = document.querySelector('.rt-step-body'); return el.getBoundingClientRect().width; });
      const point = await evaluate(() => { const r = document.querySelector('.rt-step-body').getBoundingClientRect(); return { x: Math.round(r.x+20), y: Math.round(r.y+20) }; });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await delay(100);
      const routineLayout = await evaluate(() => { const el = document.querySelector('.rt-step-body'), name = el.querySelector('.rt-step-title'); return { width: el.getBoundingClientRect().width, fits: name.scrollWidth <= name.clientWidth, wraps: getComputedStyle(name).whiteSpace === 'normal' }; });
      assert.equal(routineLayout.width, beforeHover, 'Hover must reserve action space');
      assert.equal(routineLayout.fits, true); assert.equal(routineLayout.wraps, true);
      await fs.writeFile(path.join(output, `routine-long-name-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('[aria-label="Close step inspector"]'); await click('.library-tabs button', 'Paths');
    }
    check('waypoint badges and long routine names remain readable without hover layout shifts at both supported sizes');
    if (process.env.BORDEAUX_DURATION_PROJECT) {
      saved = JSON.parse(await fs.readFile(process.env.BORDEAUX_DURATION_PROJECT, 'utf8'));
      saved.editor = { activePathId: saved.paths[0].id };
      saved.routines = [{ id: 'duration-regression', name: 'Duration regression', nodes: saved.paths.map((path, index) => ({ id: 'duration-step-' + index, type: 'path', ref: path.id })) }];
      saved.activeRoutineId = 'duration-regression';
      await win.loadFile(path.resolve('dist-renderer/index.html'));
      await wait(() => evaluate(() => document.querySelectorAll('.library-meta').length > 1 && [...document.querySelectorAll('.library-meta')].every((label) => /^\d+\.\d{2} s$/.test(label.textContent))), 'actual project durations with stale optimization');
      await evaluate(() => document.querySelectorAll('.outline .sechead-toggle').forEach((button) => { if (button.getAttribute('aria-expanded') === 'false') button.click(); }));
      assert.equal(await evaluate(() => document.querySelector('.field-status')?.textContent.includes('Using normal trajectory') || false), false, 'Normal fallback does not show a passive banner');
      const outlineLayout = await evaluate(() => ({
        titleTag: document.querySelector('.library-section-title').tagName,
        addButtons: document.querySelectorAll('.outline .sechead .mini').length,
        rowStarts: [...document.querySelectorAll('.outline .featselect')].map((row) => row.getBoundingClientRect().x),
        labelTransforms: [...document.querySelectorAll('.ctxinsp .numlbl,.ctxinsp .cgroup-h')].map((label) => getComputedStyle(label).textTransform),
      }));
      assert.equal(outlineLayout.titleTag, 'DIV', 'Outline title does not add another collapse control');
      assert.equal(outlineLayout.addButtons, 0, 'Features are placed using the field tools');
      assert.ok(outlineLayout.rowStarts.length > 4 && Math.max(...outlineLayout.rowStarts) - Math.min(...outlineLayout.rowStarts) < 1, 'Waypoint and feature content columns align');
      assert.ok(outlineLayout.labelTransforms.every((value) => value === 'none'), 'Inspector labels preserve sentence case');
      const segmentLayout = await evaluate(() => [...document.querySelectorAll('.segfeatrow')].map((row) => {
        const name = row.querySelector('.featnm'), meta = row.querySelector('.featmeta');
        return { wraps: getComputedStyle(name).whiteSpace === 'normal', fits: name.scrollWidth <= name.clientWidth + 1, stacked: meta.getBoundingClientRect().top >= name.getBoundingClientRect().bottom };
      }));
      assert.ok(segmentLayout.length > 0 && segmentLayout.every((row) => row.wraps && row.fits && row.stacked), 'Segment names wrap without truncation, with curve type below');
      check('outline groups share aligned item rows without nested collapse or arbitrary add controls');
      await fs.writeFile(path.join(output, 'actual-project-durations.png'), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Routines');
      await wait(() => evaluate(() => !document.querySelector('.routine-status') && document.querySelectorAll('.rt-step.path').length > 1), 'actual routine uses current normal trajectories');
      assert.equal(await evaluate(() => [...document.querySelectorAll('.rt-step-meta')].some((label) => /unavailable|Preparing/.test(label.textContent))), false);
      await fs.writeFile(path.join(output, 'actual-project-routine.png'), (await win.webContents.capturePage()).toPNG());
      check('actual saved project shows both durations and routine preview despite an outdated optimization');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
    app.exit(0);
  } catch (error) { console.error(error); console.error(errors); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); if (win) await fs.writeFile(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); app.exit(1); }
});
