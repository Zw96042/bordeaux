const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.BORDEAUX_BRANCH_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win, saved, saves = 0;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn, label) { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(75); } throw Error('Timed out: ' + label); }
async function click(selector, text) {
  const point = await evaluate((selector, text) => {
    const item = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.trim() === text || (el.getAttribute('role') === 'menuitem' && el.querySelector('span')?.textContent.trim() === text));
    if (!item || item.disabled) throw Error('Missing control: ' + selector + ' ' + text);
    item.scrollIntoView({ block: 'nearest' });
    const r = item.getBoundingClientRect(), x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    if (!item.contains(document.elementFromPoint(x, y))) throw Error('Obscured control: ' + selector);
    return { x, y };
  }, selector, text);
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point });
  await delay(80);
}
async function key(keyCode) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await delay(70); }
async function choose(name) { await click('#command-branch-output'); await click('[role="option"]', name); }
async function snapshot(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
const catalog = { runtime: 'labview', projectName: 'Inspection fixture', sourceFileCount: 1, scannedAt: '', warnings: [], commands: [{
  id: 'inspect', label: 'Inspect game piece and determine scoring route', member: 'Inspect.vi', ownerType: 'LabVIEW', kind: 'factory', confidence: 'confirmed', source: { file: 'Inspect.vi', line: 1 }, parameters: [],
  labviewConnector: {}, outputs: [
    { name: 'ready', label: 'Ready', schema: { kind: 'boolean', valueType: 'Boolean' } },
    { name: 'result', label: 'Result', schema: { kind: 'enum', valueType: 'enum', enumValues: ['Success', 'Retry', 'Failed'] } },
    { name: 'distance', label: 'Measured distance to scoring target', schema: { kind: 'number', valueType: 'DBL' } },
  ],
}] };
ipcMain.handle('branches:restore', () => ({ project: saved }));
ipcMain.handle('branches:catalog', () => ({ catalog, bookmarkId: 'fixture' }));
ipcMain.handle('branches:save', (_event, project) => { saved = project; saves++; return { saved: true }; });
app.whenReady().then(async () => {
  try {
    const corpus = JSON.parse(await fs.readFile('benchmarks/planner-corpus/v1/corpus.bordeaux.json', 'utf8'));
    const first = structuredClone(corpus.paths.find((p) => p.id === 'corpus-neutral-stop'));
    saved = { ...corpus, paths: [first], pathLinks: [], routines: [{ id: 'route-test', name: 'Command output branching', nodes: [{ id: 'inspect-step', type: 'function', cat: 'command', title: catalog.commands[0].label, invocation: { commandId: 'inspect', arguments: {} } }] }], activeRoutineId: 'route-test', editor: { activePathId: first.id, robotProjectBookmarkId: 'fixture', unitSystem: 'metric' } };
    win = new BrowserWindow({ show: true, width: 1440, height: 900, useContentSize: true, webPreferences: { preload: path.join(__dirname, 'verify-command-branches-ui-preload.cjs'), sandbox: false, contextIsolation: true } });
    win.webContents.on('console-message', (details) => { if (details.level === 'error' && !details.message.startsWith("Loading the font 'data:")) errors.push(details.message); });
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-tabs')), 'restored project');
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="route-test"]');
    await click('[data-id="inspect-step"] .rt-step-body');
    await wait(() => evaluate(() => document.querySelector('#command-branch-output')), 'inspector');
    await snapshot('empty-1440');
    await click('#command-branch-output'); await key('Down'); await key('Enter');
    await wait(() => evaluate(() => document.querySelectorAll('.rt-branch').length === 2), 'boolean routes');
    assert.equal(await evaluate(() => document.activeElement.id), 'command-branch-output');
    await snapshot('boolean-1440');
    await choose('ResultNamed outcomes');
    await wait(() => evaluate(() => document.querySelectorAll('.rt-branch').length === 4), 'named routes');
    await snapshot('named-1440');
    await choose('Measured distance to scoring targetnumber');
    await click('.command-branches button', 'Add comparison');
    assert.equal(await evaluate(() => document.querySelectorAll('.rt-branch').length), 3);
    await click('button[id^="route-operator-"]'); await key('Up'); await key('Up'); await key('Up'); await key('Enter');
    await click('input[id^="route-value-"]');
    await key('Home');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['shift'] });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['shift'] });
    await win.webContents.insertText('12.5'); await key('Enter');
    await wait(() => evaluate(() => [...document.querySelectorAll('.rt-brkey')].some((el) => el.textContent === '< 12.5')), 'typed numeric comparison');

    await click('.rt-branch .rt-add'); await click('.rt-ch-row', 'PathFollow a planned trajectory');
    await wait(() => evaluate(() => document.querySelector('.rt-branch .rt-step.path')), 'nested path');
    await click('[data-id="inspect-step"] .rt-step-body');
    await snapshot('numeric-populated-1440');
    await click('button[aria-label="Project menu"]'); await click('[role="menuitem"]', 'Save');
    await wait(() => saves > 0, 'save');
    assert.equal(saved.routines[0].nodes[0].outputBranch.routes.length, 3);
    assert.equal(saved.routines[0].nodes[0].outputBranch.routes[0].value, 12.5);
    assert.equal(saved.routines[0].nodes[0].outputBranch.routes[0].operator, 'lt');
    assert.equal(saved.routines[0].nodes[0].outputBranch.routes[0].nodes.length, 1);
    saved.editor.unitSystem = 'imperial';
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-tabs')), 'reload');
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="route-test"]');
    await click('[data-id="inspect-step"] .rt-step-body');
    win.setContentSize(1100, 720); await delay(200);
    await snapshot('numeric-restored-1100');
    await click('input[id^="route-value-"]');
    await snapshot('numeric-comparison-editor-1100');
    await click('#command-branch-output'); await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.id), 'command-branch-output');
    await key('Tab');
    assert.ok(await evaluate(() => document.activeElement !== document.body));
    await click('button[aria-label="Close step inspector"]');
    await snapshot('numeric-inspector-closed-1100');
    catalog.commands[0].outputs = [];
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => document.querySelector('.library-tabs')), 'missing output reload');
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="route-test"]');
    await click('[data-id="inspect-step"] .rt-step-body');
    await wait(() => evaluate(() => document.body.textContent.includes('The saved output is missing')), 'missing output message');
    assert.equal(await evaluate(() => document.querySelectorAll('.rt-branch').length), 3);
    await click('#command-branch-output'); await key('Escape');
    await snapshot('missing-output-1100');
    assert.deepEqual(errors, []);
    console.log('PASS: boolean, enum, numeric routes; nested path; save/reload; pointer and keyboard; 1440×900 and 1100×720; metric and imperial fixtures.');
  } catch (error) { console.error(error, errors); if (win) await snapshot('failure'); process.exitCode = 1; }
  finally { if (win) win.destroy(); app.exit(process.exitCode || 0); }
});
