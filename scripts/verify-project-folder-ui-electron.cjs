const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.BORDEAUX_PROJECT_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win, project, location = null, nextOpen = null, openFailure = false, saveMode = 'success', finishSave, dirty = false;
const calls = [], checks = [], errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(40); } throw new Error('Timed out: ' + label); }
async function pointer(selector) {
  await wait(() => evaluate((s) => { const el = document.querySelector(s); return el && !el.disabled && !el.closest('[inert]'); }, selector), selector);
  const point = await evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, selector);
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  await delay(80);
}
async function key(keyCode) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await delay(80); }
const status = () => evaluate(() => document.querySelector('.library-save-status')?.textContent || '');
async function projectAction(label) {
  await pointer('[aria-label="Project menu"]');
  const index = await evaluate((text) => [...document.querySelectorAll('#project-menu [role="menuitem"]')].findIndex((item) => item.textContent.startsWith(text)), label);
  assert.ok(index >= 0, 'Project action: ' + label);
  await pointer('#project-menu > button:nth-of-type(' + (index + 1) + ')');
}
const check = (name) => { checks.push(name); console.log('PASS ' + name); };
async function screenshot(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
ipcMain.handle('fixture:restore', () => ({ project, location }));
ipcMain.handle('fixture:open', (_e, kind) => { calls.push(kind); if (openFailure) throw new Error('Cannot open the selected project folder.'); if (!nextOpen) return null; const result = nextOpen; nextOpen = null; project = result.project; location = result.location; return result; });
ipcMain.handle('fixture:reset', () => { throw new Error('New must not reset before folder selection'); });
ipcMain.handle('fixture:autosave', (_e, value) => { calls.push('autosave'); if (location) project = value; return { saved: !!location, location }; });
ipcMain.handle('fixture:save', (_e, value, saveAs) => {
  calls.push(saveAs ? 'save-as' : 'save'); project = value;
  if (saveMode === 'pending') return new Promise((resolve) => { finishSave = resolve; });
  if (saveMode === 'cancel') return { canceled: true };
  if (saveMode === 'failure') throw new Error('The project folder is not writable. Choose another folder.');
  if (!location) location = { folderPath: '/fixture/My saved project', projectPath: '/fixture/My saved project/Project.bordeaux' };
  return { saved: true, location, ...(saveMode === 'error' ? { exportError: 'Project saved; BDX saving did not complete. Some BDX files may have been updated. Opening move has an invalid command. Correct the command and save again.' } : {}) };
});
ipcMain.on('fixture:dirty', (_e, value) => { dirty = value; });
app.whenReady().then(async () => {
  try {
    const corpus = JSON.parse(await fs.readFile(path.resolve('benchmarks/planner-corpus/v1/corpus.bordeaux.json'), 'utf8'));
    const source = corpus.paths.find((item) => item.id === 'corpus-neutral-stop');
    project = { ...corpus, name: 'Project folder workflow', paths: [{ ...source, id: 'opening', name: 'Opening move' }], routines: [], pathLinks: [], editor: { activePathId: 'opening' } };
    win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, 'verify-project-folder-ui-preload.cjs') } });
    win.webContents.on('console-message', (details) => { if (details.level === 'error' && !details.message.startsWith("Loading the font 'data:font/woff2")) errors.push(details.message); });
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-current-name')?.textContent === 'Opening move'), 'restore');
    await wait(() => evaluate(() => !!document.querySelector('.toolbar')), 'editor ready');
    await delay(250);
    await screenshot('choose-folder-1440');
    await projectAction('Open project…');
    assert.equal(calls.at(-1), 'folder');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Opening move');
    check('Open selects a folder and cancel preserves the project');
    win.webContents.send('fixture:menu', 'new-project'); await delay(100);
    assert.equal(calls.at(-1), 'new-folder');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Opening move');
    check('New selects a folder without resetting on cancel');
    openFailure = true;
    win.webContents.send('fixture:menu', 'new-project');
    await wait(() => evaluate(() => document.querySelector('[data-retry-open]') === document.activeElement), 'opening recovery focused');
    assert.equal(await status(), '', 'Opening errors are not save errors');
    await delay(1100);
    assert.ok(await evaluate(() => document.querySelector('.project-menu [role="alert"]')?.textContent.includes('Cannot open')), 'Autosave must not clear opening errors');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(100); await screenshot('open-failure-' + width);
    }
    win.setContentSize(1440, 900);
    const beforeOpenRetry = calls.length;
    openFailure = false;
    await pointer('[data-retry-open]');
    assert.ok(calls.slice(beforeOpenRetry).includes('new-folder'), 'Retry reopens the folder picker');
    assert.ok(!calls.slice(beforeOpenRetry).includes('save'), 'Retry must not save the old project');
    await pointer('[aria-label="Project menu"]');
    assert.ok(await evaluate(() => document.querySelector('.project-menu [role="alert"]')), 'Cancel keeps the failure available');
    await key('Escape'); await projectAction('Dismiss opening error');
    check('folder-opening failure retains context and retries the actual picker without autosave clearing it');
    await pointer('.library-tools button'); await key('Escape');
    await wait(async () => dirty, 'unsaved authored path');
    await evaluate(() => { window.discardPrompts = 0; window.confirm = () => { window.discardPrompts++; return false; }; });
    saveMode = 'cancel';
    await projectAction('Save');
    assert.equal(calls.at(-1), 'save');
    assert.equal(location, null);
    assert.equal(project.paths[0].name, 'Opening move');
    check('Choosing a first save folder preserves the draft on cancel');
    saveMode = 'failure';
    await projectAction('Save');
    await wait(async () => (await status()).includes('not writable'), 'source save failure');
    await delay(1100);
    assert.ok((await status()).includes('not writable'), 'Autosave must not hide an explicit save failure');
    const beforeRetry = calls.length;
    saveMode = 'success';
    await pointer('.library-save-status button');
    await wait(async () => !(await status()), 'first folder saved');
    assert.ok(calls.slice(beforeRetry).includes('save'));
    assert.equal(project.paths[0].name, 'Opening move');
    assert.equal(project.paths.length, 2);
    assert.equal(await evaluate(() => window.discardPrompts), 0);
    check('Retry saves the current project without quitting or discarding it');
    nextOpen = { project: { ...project, name: 'Autonomous paths and competition routines with a long project name', editor: { ...project.editor, unitSystem: 'imperial' } }, location: { folderPath: '/fixture/Autonomous paths and competition routines', projectPath: '/fixture/Autonomous paths and competition routines/Project.bordeaux' } };
    await projectAction('Open project…');
    await wait(async () => !(await status()), 'folder opened');
    await delay(1100);
    saveMode = 'pending'; await projectAction('Save');
    assert.equal(await evaluate(() => document.querySelector('[aria-label="Project menu"]').getAttribute('aria-busy')), 'true'); await screenshot('saving-1440');
    finishSave({ saved: true, location, exportError: 'Project saved; BDX saving did not complete. Some BDX files may have been updated. Opening move has an invalid command. Correct the command and save again.' });
    await wait(async () => (await status()).includes('Project saved; BDX'), 'export failure');
    assert.equal(dirty, false);
    for (const [width, height] of [[1440, 900], [1100, 720]]) { win.setContentSize(width, height); await delay(120); await screenshot('bdx-failure-' + width); }
    check('Source save succeeds while BDX failure remains actionable');
    // A real new path edit schedules autosave; its success must retain the export error.
    await pointer('.library-tools button');
    await key('Escape');
    await delay(1200);
    assert.ok((await status()).includes('Project saved; BDX'));
    check('Background source autosave preserves the BDX failure');
    saveMode = 'success'; await pointer('.library-save-status button');
    await wait(async () => !(await status()).includes('BDX'), 'retry succeeds');
    assert.equal(calls.at(-1), 'save');
    check('Retry BDX save regenerates through explicit Save');
    await pointer('[aria-label="Project menu"]');
    assert.equal(await evaluate(() => document.activeElement.textContent.startsWith('Open project')), true);
    await key('Down');
    assert.equal(await evaluate(() => document.activeElement.textContent.startsWith('Save')), true);
    await key('Enter');
    assert.equal(calls.at(-1), 'save');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Project menu');
    await key('Space');
    await wait(() => evaluate(() => !!document.querySelector('#project-menu')), 'Space opens menu');
    await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Project menu');
    await key('Down'); await key('End');
    assert.equal(await evaluate(() => document.activeElement.textContent.startsWith('Save as')), true);
    await key('Home'); await key('Tab');
    assert.equal(await evaluate(() => !!document.querySelector('#project-menu')), false);
    check('Project menu supports pointer, arrows, Enter, Space, Escape and Tab with focus return');
    saveMode = 'cancel'; await projectAction('Save as…');
    assert.equal(calls.at(-1), 'save-as');
    win.webContents.send('fixture:menu', 'open-project-file'); await delay(120);
    assert.equal(calls.at(-1), 'file');
    check('Save As and explicit legacy project file commands remain separate');
    saveMode = 'failure'; win.webContents.send('fixture:menu', 'save-project-as');
    await wait(async () => (await status()).includes('not writable'), 'Save As failure');
    await pointer('.pageswitch button:nth-child(2)');
    await pointer('[aria-label="Project menu"]');
    assert.ok(await evaluate(() => document.querySelector('.project-menu-error')?.textContent.includes('not writable')));
    await screenshot('settings-save-error');
    await key('Escape');
    await pointer('.pageswitch button:first-child');
    check('Save failure details remain reachable from Settings');
    saveMode = 'success'; await pointer('.library-save-status button');
    assert.equal(calls.at(-1), 'save-as');
    check('Retry preserves the Save As folder selection');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(250);
      const toolbar = await evaluate(() => {
        const buttons = [...document.querySelectorAll('.tb-right > button')];
        return buttons.map((button) => {
          const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
          return { label: button.textContent, left: rect.left, right: rect.right, height: rect.height, padding: parseFloat(style.paddingLeft), clipped: button.scrollWidth > button.clientWidth };
        });
      });
      for (const [index, button] of toolbar.entries()) {
        assert.ok(button.height >= 40 && button.left >= 0 && button.right <= width, JSON.stringify(button));
        assert.equal(button.clipped, false, JSON.stringify(button));
        if (index) assert.ok(button.left >= toolbar[index - 1].right + 5, 'Toolbar controls must not overlap');
      }
      assert.ok(toolbar.find((button) => button.label === 'Optimize').padding >= 12);
      await screenshot('folder-ready-' + width);
      await pointer('[aria-label="Project menu"]');
      const bounds = await evaluate(() => { const r = document.querySelector('#project-menu').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= height);
      assert.ok(await evaluate(() => document.querySelector('.project-menu-heading').textContent.includes('Autonomous paths and competition routines with a long project name')));
      await screenshot('project-menu-' + width);
      await key('Escape');
    }
    await pointer('.keyboard-help-trigger'); await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Keyboard shortcuts');
    await pointer('[aria-label="Hide inspector"]');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(250); await screenshot('folder-ready-inspector-closed-' + width);
    }
    check('Toolbar spacing, keyboard focus and inspector layouts remain usable at supported sizes');
    await pointer('.library-tabs button:nth-child(2)');
    await pointer('.library-tools button'); await key('Escape');
    for (const [selector, count] of [
      ['.routine-workspace-flow .rt-add', 1],
      ['.routine-workspace-flow .rt-list > .rt-gap .rt-gap-btn', 2],
      ['.routine-workspace-flow .rt-list > .rt-addwrap .rt-add', 3],
    ]) {
      await pointer(selector); await key('Tab');
      assert.equal(await evaluate(() => document.activeElement.matches('.rt-ch-row')), true);
      await key('Enter');
      assert.equal(await evaluate(() => document.activeElement.matches('.rt-step.sel > .rt-step-body')), true);
      assert.equal(await evaluate(() => document.querySelectorAll('.routine-workspace-flow .rt-step').length), count);
    }
    check('First, gap and end routine insertion focus the inserted step');
    await pointer('.library-tabs button:first-child');
    await pointer('[aria-label="Actions for Opening move"]');
    await key('End'); await key('Enter');
    assert.equal(await evaluate(() => document.activeElement.matches('.library-blocked button')), true);
    await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.dataset.libraryItem), 'opening');
    assert.equal(await evaluate(() => !!document.querySelector('.library-blocked')), false);
    check('Blocked deletion focuses recovery and Escape returns to the affected path');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2)); app.exit(0);
  } catch (error) { console.error(error); if (win) await screenshot('failure'); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); app.exit(1); }
});
