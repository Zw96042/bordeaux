const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.BORDEAUX_PLANNING_RECOVERY_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win, saved, saves = 0;
const autosaves = [];
const location = { folderPath: '/fixtures/Recovery project', projectPath: '/fixtures/Recovery project/.bordeaux-workspace.json' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(75); } throw Error('Timed out: ' + label); }
async function focusWindow() {
  app.focus({ steal: true }); win.focus(); win.webContents.focus();
  await wait(() => evaluate(() => document.hasFocus()), 'renderer keyboard focus');
}
async function click(selector, text, clickCount = 1) {
  await focusWindow();
  await wait(() => evaluate((selector, text) => {
    const item = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.trim() === text || (el.getAttribute('role') === 'menuitem' && el.querySelector('span')?.textContent.trim() === text));
    return !!item && !item.disabled && !item.closest('[inert]');
  }, selector, text), 'enabled control: ' + selector + (text ? ' ' + text : ''));
  const point = await evaluate((selector, text) => {
    const item = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.trim() === text || (el.getAttribute('role') === 'menuitem' && el.querySelector('span')?.textContent.trim() === text));
    if (!item || item.disabled) throw Error('Missing control: ' + selector + ' ' + text);
    item.scrollIntoView({ block: 'nearest' });
    const r = item.getBoundingClientRect(), x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    if (!item.contains(document.elementFromPoint(x, y))) throw Error('Obscured control: ' + selector);
    return { x, y };
  }, selector, text);
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount, modifiers: [], ...point });
  await delay(350);
}
async function key(keyCode) { await focusWindow(); win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [] }); if (keyCode === 'Space') win.webContents.sendInputEvent({ type: 'char', keyCode: ' ', modifiers: [] }); if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: [] }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [] }); await delay(70); }
async function snapshot(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
ipcMain.handle('branches:restore', () => ({ project: saved, location }));
ipcMain.handle('branches:catalog', () => ({ catalog: { projectName: 'Fixture', commands: [], warnings: [] }, bookmarkId: 'fixture' }));
ipcMain.handle('branches:save', (_event, project) => { saved = project; saves++; return { saved: true, location }; });
ipcMain.handle('branches:autosave', (_event, project) => { autosaves.push(project); return { saved: true, location }; });
async function save() { const before = saves; await click('button[aria-label="Project menu"]'); await click('[role="menuitem"]', 'Save'); await wait(() => saves > before, 'save');
}
app.whenReady().then(async () => {
  try {
    const corpus = JSON.parse(await fs.readFile('benchmarks/planner-corpus/v1/corpus.bordeaux.json', 'utf8'));
    const first = structuredClone(corpus.paths.find((p) => p.id === 'corpus-neutral-stop'));
    first.name = 'Path 1'; first.ranges = [];
    saved = { ...corpus, paths: [first], pathLinks: [], routines: [], editor: { activePathId: first.id, unitSystem: 'metric' } };
    win = new BrowserWindow({ show: true, width: 1440, height: 900, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'verify-planning-recovery-ui-preload.cjs'), sandbox: false, contextIsolation: true, backgroundThrottling: false } });
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => !!document.querySelector('.cbar') && !document.querySelector('.fieldcol[data-planning-ready="false"]')), 'current trajectory');
    assert.ok(await evaluate(() => document.querySelector('.project-menu-trigger')?.textContent.includes('Recovery project') || document.querySelector('.toolbar').textContent.includes('Recovery project')));
    await evaluate(() => {
      const post = Worker.prototype.postMessage;
      window.restorePlanner = () => { Worker.prototype.postMessage = post; delete window.restorePlanner; };
      Worker.prototype.postMessage = function(message, ...args) {
        if (message.quality === 'interactive' && message.path.constraints.maxVel === 0.5) {
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: { message: 'Controlled planning failure' } } })), 0);
          return;
        }
        return post.call(this, message, ...args);
      };
    });
    await click('.cbar');
    async function number(label, value, pauseForAutosave = false) {
      const selector = await evaluate(label => {
        const el = [...document.querySelectorAll('.ctxinsp label')].find(el => el.textContent === label);
        if (!el) throw Error('Missing number ' + label);
        return '#' + CSS.escape(el.htmlFor);
      }, label);
      await click(selector);
      await evaluate(selector => { const input = document.querySelector(selector); input.focus(); input.select(); }, selector);
      await win.webContents.insertText(String(value));
      if (pauseForAutosave) {
        await delay(1150);
        assert.equal(await evaluate(selector => document.activeElement === document.querySelector(selector), selector), true, 'Background save must not blur the numeric draft');
        assert.equal(await evaluate(selector => document.querySelector(selector).value, selector), String(value));
        assert.ok(autosaves.length > 0);
        assert.equal(autosaves.at(-1).paths[0].constraints.maxVel, first.constraints.maxVel, 'Background save includes committed values without stealing the live draft');
      }
      await evaluate(selector => document.querySelector(selector).focus(), selector);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: [] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: [] });
      await delay(100);
    }
    await number('Max vel', 0.5, true);
    await wait(() => evaluate(() => document.querySelector('.field-status-label')?.textContent === 'Trajectory unavailable'), 'failure banner');
    await snapshot('failure-before-recovery');
    assert.ok(await evaluate(() => document.querySelector('.cbar').textContent.includes('0.5')), 'Constraint summary reflects the failed authored value, not stale timing');
    assert.equal(await evaluate(() => !!document.querySelector('.field-status').closest('[inert]')), false, 'Planning failure details and recovery must accept native input');
    assert.equal(await evaluate(() => !!document.querySelector('.ctxinsp-body').closest('[inert]')), false, 'Authored limit edits remain usable');
    assert.equal(await evaluate(() => !!document.querySelector('.fieldsvg').closest('[inert]')), true, 'Stale field geometry remains inert');
    assert.equal(await evaluate(() => !!document.querySelector('.transport').closest('[inert]')), true, 'Stale playback remains inert');
    await click('[aria-label="Hide inspector"]');
    await click('.field-status summary');
    assert.equal(await evaluate(() => document.querySelector('.field-status details').open), true);
    assert.ok(await evaluate(() => document.querySelector('.field-status-details').textContent.includes('Controlled planning failure')));
    await click('.field-status-action');
    await wait(() => evaluate(() => !!document.querySelector('.ctxinsp-body') && !document.querySelector('.optimizer-panel')), 'direct limit recovery');
    for (const [width, height] of [[1440,900],[1100,720]]) {
      win.setContentSize(width,height); await delay(100); await snapshot('repair-' + width);
    }
    await number('Max vel', 2);
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[data-planning-ready="false"]') && !document.querySelector('.field-status-label')), 'edited limit restores trajectory');
    await save();
    assert.equal(saved.name, 'Recovery project');
    assert.equal(saved.paths[0].constraints.maxVel, 2);
    assert.deepEqual(saved.paths[0].waypoints, first.waypoints);
    await snapshot('recovered');
    await number('Acceleration', 1.25);
    await save();
    assert.equal(saved.paths[0].constraints.maxAccel, 1.25);
    assert.equal(saved.paths[0].constraints.maxDecel, 1.25);
    assert.equal(await evaluate(() => [...document.querySelectorAll('.ctxinsp label')].some(el => /decel/i.test(el.textContent))), false);
    await evaluate(() => window.restorePlanner());
    await number('Max vel', 0.5);
    await wait(() => evaluate(() => document.querySelector('.fieldcol')?.dataset.planningReady === 'true'), 'real whole-path 0.5 velocity trajectory');
    await save(); assert.equal(saved.paths[0].constraints.maxVel, 0.5);
    await snapshot('low-velocity-path');
    console.log('PASS Native failure details/recovery, current limit edits, inert stale geometry/playback, restored trajectory');
  } catch (error) { console.error(error); if(win) await snapshot('failure'); process.exitCode=1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
