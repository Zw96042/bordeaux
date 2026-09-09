const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const output = process.env.BORDEAUX_PROJECT_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win, project, location = null, nextOpen = null, saveMode = 'success', finishSave, dirty = false;
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
const status = () => evaluate(() => document.querySelector('.library-save-status')?.textContent);
const check = (name) => { checks.push(name); console.log('PASS ' + name); };
async function screenshot(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
ipcMain.handle('fixture:restore', () => ({ project, location }));
ipcMain.handle('fixture:open', (_e, kind) => { calls.push(kind); if (!nextOpen) return null; const result = nextOpen; nextOpen = null; project = result.project; location = result.location; return result; });
ipcMain.handle('fixture:reset', () => { throw new Error('New must not reset before folder selection'); });
ipcMain.handle('fixture:autosave', (_e, value) => { calls.push('autosave'); if (location) project = value; return { saved: !!location, location }; });
ipcMain.handle('fixture:save', (_e, value, saveAs) => {
  calls.push(saveAs ? 'save-as' : 'save'); project = value;
  if (saveMode === 'pending') return new Promise((resolve) => { finishSave = resolve; });
  if (saveMode === 'cancel') return { canceled: true };
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
    await screenshot('choose-folder-1440');
    await pointer('.toolbar [aria-label="Open project folder"]');
    assert.equal(calls.at(-1), 'folder');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Opening move');
    check('Open selects a folder and cancel preserves the project');
    win.webContents.send('fixture:menu', 'new-project'); await delay(100);
    assert.equal(calls.at(-1), 'new-folder');
    assert.equal(await evaluate(() => document.querySelector('.library-current-name').textContent), 'Opening move');
    check('New selects a folder without resetting on cancel');
    nextOpen = { project, location: { folderPath: '/fixture/Autonomous paths and competition routines', projectPath: '/fixture/Autonomous paths and competition routines/Project.bordeaux' } };
    await pointer('.toolbar [aria-label="Open project folder"]');
    await wait(async () => (await status()).includes('Paths and routines autosave'), 'folder opened');
    await delay(1100);
    saveMode = 'pending'; await pointer('[aria-label="Save project"]');
    assert.equal(await status(), 'Saving…'); await screenshot('saving-1440');
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
    await pointer('.toolbar [aria-label="Open project folder"]');
    await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Save project');
    await key('Enter');
    assert.equal(calls.at(-1), 'save');
    check('Open and Save support pointer, Tab and Enter');
    saveMode = 'cancel'; win.webContents.send('fixture:menu', 'save-project-as'); await delay(120);
    assert.equal(calls.at(-1), 'save-as');
    win.webContents.send('fixture:menu', 'open-project-file'); await delay(120);
    assert.equal(calls.at(-1), 'file');
    check('Save As and explicit legacy project file commands remain separate');
    for (const [width, height] of [[1440, 900], [1100, 720]]) { win.setContentSize(width, height); await delay(120); await screenshot('folder-ready-' + width); }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2)); app.exit(0);
  } catch (error) { console.error(error); if (win) await screenshot('failure'); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); app.exit(1); }
});
