const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.BORDEAUX_RANGE_LIMITS_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win, saved, saves = 0;
const errors = [];
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
ipcMain.handle('branches:restore', () => ({ project: saved }));
ipcMain.handle('branches:catalog', () => ({ catalog: { projectName: 'Fixture', commands: [], warnings: [] }, bookmarkId: 'fixture' }));
ipcMain.handle('branches:save', (_event, project) => { saved = project; saves++; return { saved: true }; });
async function save() { const before = saves; await click('button[aria-label="Project menu"]'); await click('[role="menuitem"]', 'Save'); await wait(() => saves > before, 'save');
}
app.whenReady().then(async () => {
  try {
    const corpus = JSON.parse(await fs.readFile('benchmarks/planner-corpus/v1/corpus.bordeaux.json', 'utf8'));
    const first = structuredClone(corpus.paths.find((p) => p.id === 'corpus-neutral-stop'));
    first.name = 'Path 1';
    first.ranges = [{ anchor: 'param', f0: 0.15, f1: 0.85 }];
    saved = { ...corpus, paths: [first], pathLinks: [], routines: [], editor: { activePathId: first.id, unitSystem: 'metric' } };
    win = new BrowserWindow({ show: true, width: 1440, height: 900, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'verify-command-branches-ui-preload.cjs'), sandbox: false, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.on('console-message', (details) => { if (details.level === 'error' && !details.message.startsWith("Loading the font 'data:")) errors.push(details.message); });
    const load = async () => {
      await win.loadFile(path.resolve('dist-renderer/index.html'));
      win.focus(); win.webContents.focus();
      await wait(() => evaluate(() => !!document.querySelector('.sechead-toggle') && !document.querySelector('.fieldcol[data-planning-ready="false"]')), 'editable path');
      if (!await evaluate(() => !!document.querySelector('button[aria-label^="Zone,"]'))) await click('.sechead-toggle', 'Zones1');
      await click('button[aria-label^="Zone,"]', undefined, 2);
      await wait(() => evaluate(() => !!document.querySelector('.range-limits')), 'region limits');
    };
    const activeLimits = () => Object.keys(saved.paths[0].ranges[0]).filter((key) => key.startsWith('max') && saved.paths[0].ranges[0][key] != null);
    if (!process.env.BORDEAUX_RANGE_LIMITS_REMAINDER_ONLY) {
    await load();
    assert.equal(await evaluate(() => document.querySelectorAll('.range-limits .range-limit').length), 0);
    await snapshot('empty-1440');
    await click('#range-add-limit');
    await snapshot('add-limit-menu-1440');
    await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.id), 'range-add-limit');
    await key('Enter');
    await key('Down');
    assert.equal(await evaluate(() => document.activeElement.textContent.trim()), 'Acceleration');
    await key('Enter'); await delay(350);
    await click('#range-add-limit');
    assert.equal(await evaluate(() => [...document.querySelectorAll('[role="option"]')].some((item) => item.textContent.trim() === 'Acceleration')), false);
    await key('Escape');
    // Finish persistence from adding the limit before beginning a numeric draft.
    await save();
    await click('.range-limits input');
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('.range-limits input')), true, 'Native pointer input must focus the numeric field');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await delay(100);
    await evaluate(() => document.querySelector('.range-limits input').select());
    await win.webContents.insertText('1.23'); await key('Enter');
    await save();
    assert.deepEqual(activeLimits(), ['maxAccel', 'maxDecel']);
    assert.equal(saved.paths[0].ranges[0].maxAccel, 1.23);
    assert.equal(saved.paths[0].ranges[0].maxDecel, 1.23);
    await click('.range-limits input');
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('.range-limits input')), true, 'Native pointer input must focus the numeric field');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await delay(100);
    await evaluate(() => document.querySelector('.range-limits input').select());
    await win.webContents.insertText('invalid'); await key('Escape'); await key('Enter');
    await save(); assert.equal(saved.paths[0].ranges[0].maxAccel, 1.23);
    assert.equal(saved.paths[0].ranges[0].maxDecel, 1.23);
    await load();
    assert.equal(await evaluate(() => document.querySelector('.range-limits input').value), '1.23');
    for (const system of ['metric', 'imperial']) {
      if (system === 'imperial') {
        await click('.pageswitch button', 'Settings');
        await click('[aria-label="Display units"] button', 'Imperial');
        await click('.pageswitch button', 'Editor');
        await click('button[aria-label^="Zone,"]', undefined, 2);
      }
      const expected = system === 'metric' ? '1.23' : '4.04';
      assert.equal(await evaluate(() => document.querySelector('.range-limits input').value), expected);
      for (const [width, height] of [[1440, 900], [1100, 720]]) {
        win.setContentSize(width, height); await delay(150);
        await snapshot(system + '-acceleration-' + width);
        await click('[aria-label="Hide inspector"]');
        await snapshot(system + '-closed-' + width);
        await click('button[aria-label^="Zone,"]', undefined, 2);
      }
      await save(); assert.deepEqual(activeLimits(), ['maxAccel', 'maxDecel']);
      assert.equal(saved.paths[0].ranges[0].maxAccel, 1.23);
    assert.equal(saved.paths[0].ranges[0].maxDecel, 1.23);
      await load();
      assert.equal(await evaluate(() => document.querySelector('.range-limits input').value), expected);
    }
    } else {
      saved.paths[0].ranges[0].maxAccel = saved.paths[0].ranges[0].maxDecel = 1.23;
      await load();
      for (const [width, height] of [[1440, 900], [1100, 720]]) {
        win.setContentSize(width, height); await delay(150); await snapshot('metric-acceleration-' + width);
      }
    }
    await click('.range-limits input');
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('.range-limits input')), true, 'Native pointer input must focus the numeric field');
    await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Remove acceleration limit');
    await save();
    assert.equal(saved.paths[0].ranges[0].maxAccel, 1.23, 'Tabbing through an unchanged imperial value must preserve its exact canonical value');
    await click('.range-limits input');
    assert.equal(await evaluate(() => document.activeElement === document.querySelector('.range-limits input')), true, 'Native pointer input must focus the numeric field');
    await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), 'Remove acceleration limit');
    await key('Space'); await delay(350);
    await save(); assert.deepEqual(activeLimits(), []);
    assert.equal(Object.hasOwn(saved.paths[0].ranges[0], 'maxAccel'), false);
    assert.equal(Object.hasOwn(saved.paths[0].ranges[0], 'maxDecel'), false);
    await load();
    assert.equal(await evaluate(() => document.querySelectorAll('.range-limits input').length), 0);
    await snapshot('disabled-restored-1100');
    saved.paths[0].ranges[0] = { ...saved.paths[0].ranges[0], maxVel: 2.3, maxAccel: 6.5, maxDecel: 2.1, maxAngVel: 123, maxAngAccel: 234 };
    await load();
    assert.equal(await evaluate(() => document.querySelectorAll('.range-limits .range-limit').length), 4);
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(150);
      await snapshot('legacy-all-enabled-' + width);
      await click('.range-limits .range-limit:nth-child(4) input');
      await evaluate(() => document.querySelector('.ctxinsp-body')?.scrollTo(0, 10000));
      await snapshot('legacy-all-enabled-scrolled-' + width);
    }
    await click('.range-limits .range-limit:nth-child(2) input');
    await key('Tab');
    await save();
    assert.equal(saved.paths[0].ranges[0].maxAccel, 6.5);
    assert.equal(saved.paths[0].ranges[0].maxDecel, 2.1, 'Opening legacy differing limits must preserve both until edited');
    await click('button[aria-label="Delete zone"]');
    await click('button[aria-label="Zone"]');
    const drag = await evaluate(() => {
      const path = document.querySelector('path[data-role="seg"][data-idx="1"]');
      const matrix = path.getScreenCTM();
      const points = Array.from({ length: 17 }, (_, index) => (index + 2) / 20).map((fraction) => { const point = path.getPointAtLength(path.getTotalLength() * fraction).matrixTransform(matrix); return { x: Math.round(point.x), y: Math.round(point.y) }; }).filter(({ x, y }) => ['seg', 'ins', 'bg'].includes(document.elementFromPoint(x, y)?.getAttribute('data-role')));
      if (points.length < 2) throw Error('No unobscured path points for region drag');
      return [points[0], points.at(-1)];
    });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, modifiers: [], ...drag[0] });
    await delay(100);
    win.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', modifiers: [], ...drag[1] });
    await delay(200);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, modifiers: [], ...drag[1] });
    await delay(500); await save();
    assert.equal(saved.paths[0].ranges.length, 1);
    assert.deepEqual(Object.keys(saved.paths[0].ranges[0]).filter((key) => key.startsWith('max')), []);
    await snapshot('new-dragged-region-1100');
    await click('.pageswitch button', 'Settings');
    await click('[aria-label="Display units"] button', 'Metric');
    await click('.pageswitch button', 'Editor');
    await click('button[aria-label^="Zone,"]', undefined, 2);
    await click('#range-add-limit');
    await click('[role="option"]', 'Velocity');
    await click('.range-limits input');
    await evaluate(() => document.querySelector('.range-limits input').select());
    await win.webContents.insertText('0.5'); await key('Enter');
    await wait(() => evaluate(() => document.querySelector('.fieldcol')?.dataset.planningReady === 'true'), '0.5 velocity zone trajectory');
    await save();
    assert.equal(saved.paths[0].ranges[0].maxVel, 0.5);
    await snapshot('low-velocity-zone-1100');
    assert.deepEqual(errors, []);
    console.log(process.env.BORDEAUX_RANGE_LIMITS_REMAINDER_ONLY ? 'PASS Native Tab/Space removal, cleared save/reload, all enabled layouts and native empty region creation' : 'PASS Independent acceleration add/remove, native pointer/arrow/Enter/Space/Tab, menu and numeric Escape, canonical values, save/reload, both units, open/closed inspector at 1440x900 and 1100x720');
  } catch (error) { console.error(error, errors); if (win) await snapshot('failure'); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
