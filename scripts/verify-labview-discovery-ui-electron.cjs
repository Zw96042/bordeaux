const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createDemoProject } = require('../dist-electron/shared/project/defaults.js');
const { discoverLabviewProject } = require('../dist-electron/electron/labviewProject.js');
const { inspectLabviewCommands } = require('../dist-electron/electron/labviewNiInspection.js');
const selection = process.env.BORDEAUX_LABVIEW_UI_PROJECT;
const output = process.env.BORDEAUX_LABVIEW_UI_OUTPUT;
assert.ok(selection && output, 'Set BORDEAUX_LABVIEW_UI_PROJECT to the exact project and BORDEAUX_LABVIEW_UI_OUTPUT to an isolated folder');
assert.ok(path.resolve(output) !== path.dirname(path.resolve(selection)) && !path.resolve(output).startsWith(path.dirname(path.resolve(selection)) + path.sep), 'Keep UI verification output outside the reference project');
app.setPath('userData', path.join(output, 'user-data'));
let win, saved, catalog, inspected, inspectionMode = 'normal', releaseInspection;
const checks = [], errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function wait(fn, label) { for (let index = 0; index < 200; index++) { if (await fn()) return; await delay(50); } throw new Error('Timed out: ' + label); }
async function pointer(selector, text) {
  await wait(() => evaluate((selector, text) => [...document.querySelectorAll(selector)].some((el) => (!text || el.textContent.includes(text)) && !el.disabled), selector, text), selector + ' ' + text);
  await evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.includes(text));
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, selector, text);
  await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const point = await evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.includes(text));
    const r = el.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit || !el.contains(hit)) throw new Error('Pointer target obscured: ' + selector + ' by ' + hit?.outerHTML.slice(0, 300));
    return { x, y };
  }, selector, text);
  win.focus(); win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await delay(40);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); await delay(40);
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); await delay(120);
  console.log('POINTER ' + selector + ' ' + (text || '') + ' ' + JSON.stringify(point));
}
async function selectMarker() {
  await wait(() => evaluate(() => [...document.querySelectorAll('.sechead-toggle')].some((el) => el.textContent.includes('Event Markers'))), 'Event Markers section');
  if (!await evaluate(() => [...document.querySelectorAll('.featselect')].some((el) => el.textContent.includes('Discovery marker')))) await pointer('.sechead-toggle', 'Event Markers');
  await pointer('.featselect', 'Discovery marker');
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(70);
}
async function shot(name) { await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await delay(80); await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
const check = (name) => { checks.push(name); console.log('PASS ' + name); };
const connection = () => ({ catalog, integration: { runtime: 'labview', installed: false, generatedCatalog: false, buildFile: 'bordeaux-catalog.json', wrapperAvailable: true }, bookmarkId: 'labview-ui',
  recentProjects: [{ id: 'labview-ui', projectName: catalog.projectName, folderName: path.basename(selection), lastLinkedAt: new Date().toISOString() }] });
ipcMain.handle('project:restoreLast', () => ({ project: saved }));
ipcMain.handle('project:save', (_event, project) => { saved = project; return { saved: true }; });
ipcMain.handle('project:autosave', () => ({ saved: false }));
ipcMain.handle('robotProject:listRecent', () => []);
ipcMain.handle('robotProject:link', () => connection());
ipcMain.handle('robotProject:openRecent', () => connection());
ipcMain.handle('robotProject:refresh', () => connection());
ipcMain.handle('robotProject:inspectLabview', async () => {
  if (inspectionMode === 'failure') throw new Error('LabVIEW inspection unavailable. Open the linked project and retry.');
  if (inspectionMode === 'pending') await new Promise((resolve) => { releaseInspection = resolve; });
  catalog = inspected; return connection();
});
ipcMain.handle('agent:getMcpStatus', () => ({ enabled: false }));
ipcMain.handle('agent:getActiveProposal', () => null);
ipcMain.handle('robot:getPairing', () => null);
// No robot transport, support installation, project write, or export handlers are installed.
app.whenReady().then(async () => {
  try {
    await fs.mkdir(output, { recursive: true });
    catalog = await discoverLabviewProject(selection);
    assert.ok(catalog.sourceFileCount > 0, 'Use a real project with native-discovered sources');
    if (process.env.BORDEAUX_LABVIEW_UI_CATALOG) inspected = JSON.parse(await fs.readFile(process.env.BORDEAUX_LABVIEW_UI_CATALOG, 'utf8'));
    else inspected = await inspectLabviewCommands(selection, path.join(output, 'cache'));
    assert.equal(inspected.labviewDiscovery.projectFile, path.basename(selection));
    const intake = inspected.commands.find((command) => command.label === 'Start Intake');
    assert.ok(intake && intake.labviewLegacy && !intake.runtimeReady, 'UI fixture must come from the actual NI-inspected Start Intake command');
    saved = createDemoProject(); saved.name = 'LabVIEW discovery verification';
    saved.paths = [saved.paths[0]]; saved.paths[0].markers = [{ id: 'discovery-marker', name: 'Discovery marker', f: 0.5, cmd: 'none' }];
    saved.routines = [{ id: 'discovery-routine', name: 'Discovery routine', nodes: [
      { id: 'first-path', type: 'path', ref: saved.paths[0].id },
      { id: 'decision', type: 'decision', cond: '', thenLabel: 'Ready', elseLabel: 'Wait', then: [{ id: 'command-step', type: 'function', cat: 'command', title: 'Inspected intake', invocation: { commandId: intake.id, arguments: Object.fromEntries(intake.parameters.map((parameter) => [parameter.name, parameter.defaultValue])) } }], else: [] },
    ] }]; saved.activeRoutineId = 'discovery-routine'; saved.editor = { activePathId: saved.paths[0].id };
    win = new BrowserWindow({ show: true, width: 1440, height: 900, useContentSize: true,
      webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false, preload: path.resolve('dist-electron/electron/preload.js') } });
    win.webContents.on('console-message', (details) => { if (details.level === 'error' && !details.message.startsWith("Loading the font 'data:font/woff2")) errors.push(details.message); });
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    win.show(); win.focus(); win.webContents.focus();
    await wait(() => evaluate(() => document.hasFocus()), 'renderer keyboard focus');
    await selectMarker();
    await pointer('.cmd-primary-action', 'Choose robot project');
    await wait(() => evaluate(() => !!document.querySelector('.labview-sources')), 'native project linked');
    await pointer('.labview-sources > summary');
    await pointer('.labview-sources input');
    await win.webContents.insertText('no-such-source-123');
    await wait(() => evaluate(() => document.querySelector('.labview-source-list').textContent.includes('No sources match')), 'empty source search');
    await key('Escape');
    assert.equal(await evaluate(() => document.querySelector('.labview-sources input').value), '');
    await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.className), 'labview-source-list');
    await pointer('.labview-sources > summary');
    check('real project links without NI; source search, empty results, Escape and Tab work');
    inspectionMode = 'pending';
    await pointer('.labview-inspection button');
    await wait(() => Boolean(releaseInspection), 'pending inspection');
    assert.equal(await evaluate(() => document.querySelector('.labview-inspection button').disabled), true);
    await shot('inspection-pending'); releaseInspection(); inspectionMode = 'normal';
    await wait(() => evaluate(() => !document.querySelector('.labview-inspection button').disabled), 'inspection complete');
    await pointer('#event-marker-command');
    await pointer('.cmd-picker-option', 'Start Intake');
    await wait(() => evaluate(() => !!document.querySelector('#event-command-param-Setpoint')), 'typed parameters');
    assert.equal(await evaluate(() => document.querySelector('#event-command-param-Setpoint').type), 'number');
    assert.ok(await evaluate(() => document.querySelector('.ctxinsp-body').textContent.includes('LabVIEW command execution is not connected yet.')));
    await pointer('#event-marker-command');
    await wait(() => evaluate(() => document.querySelector('#event-marker-command').getAttribute('aria-expanded') === 'true'), 'command picker opens for Escape');
    await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.id), 'event-marker-command');
    await key('Space');
    await wait(() => evaluate(() => document.querySelector('#event-marker-command').getAttribute('aria-expanded') === 'true'), 'Space opens command picker');
    await key('Down');
    assert.equal(await evaluate(() => document.activeElement.classList.contains('cmd-picker-option')), true);
    await key('Escape');
    assert.equal(await evaluate(() => document.activeElement.id), 'event-marker-command');
    await key('Enter');
    await wait(() => evaluate(() => document.querySelector('#event-marker-command').getAttribute('aria-expanded') === 'true'), 'Enter opens command picker');
    await key('Escape');
    await pointer('#event-marker-command');
    await pointer('.cmd-picker-option', 'Intake Immediate');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(130);
      await pointer('#event-command-param-Operation');
      assert.deepEqual(await evaluate(() => [...document.querySelectorAll('#event-command-param-Operation-listbox .cmd-picker-option strong')].map((el) => el.textContent)), ['Reserve', 'Read Current', 'Immediate', 'Start Intake']);
      await shot('enum-choices-' + width);
      await pointer('#event-command-param-Operation-listbox .cmd-picker-option', 'Immediate');
      assert.equal(await evaluate(() => document.querySelector('#event-command-param-Operation-value').textContent), 'Immediate');
    }
    win.setContentSize(1440, 900); await delay(130);
    await pointer('#event-marker-command'); await pointer('.cmd-picker-option', 'Start Intake');
    for (const [name, value] of [['Setpoint', '42.5'], ['Description', 'Discovery parameters']]) {
      await pointer('#event-command-param-' + name);
      await key('A', ['control']); await win.webContents.insertText(value); await key('Tab');
      assert.equal(await evaluate((name) => document.querySelector('#event-command-param-' + name).value, name), value);
    }
    check('NI-inspected command selection exposes DBL/string parameters and keeps unimplemented command execution unavailable');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(130);
      await pointer('#event-command-param-Setpoint');
      assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await shot('typed-command-' + width);
      await pointer('.labview-sources > summary');
      await pointer('.labview-sources input'); await win.webContents.insertText('Command Sequencer');
      await wait(() => evaluate(() => document.querySelector('.labview-sources input').value === 'Command Sequencer'), 'source filter entered');
      await shot('source-paths-' + width); await key('Escape');
      await pointer('.labview-sources > summary');
      await pointer('[aria-label="Hide inspector"]'); await shot('inspector-closed-' + width);
      await pointer('[title="Show inspector"]');
    }
    inspectionMode = 'failure'; await pointer('.labview-inspection button');
    await wait(() => evaluate(() => [...document.querySelectorAll('[role="alert"]')].some((el) => el.textContent.includes('LabVIEW inspection unavailable.'))), 'inspection failure'); await shot('inspection-failure');
    inspectionMode = 'normal'; await pointer('.labview-inspection button');
    await wait(() => evaluate(() => ![...document.querySelectorAll('[role="alert"]')].some((el) => el.textContent.includes('LabVIEW inspection unavailable.'))), 'retry clears failure');
    check('pending, failure and retry are explicit at supported window sizes');
    await pointer('.pageswitch button', 'Settings'); await pointer('[aria-label="Display units"] button', 'Imperial');
    await pointer('.pageswitch button', 'Editor'); await selectMarker(); await shot('imperial-command');
    await pointer('.pageswitch button', 'Settings'); await pointer('[aria-label="Display units"] button', 'Metric'); await pointer('.pageswitch button', 'Editor');
    await pointer('[aria-label="Save project"]');
    await win.reload(); await selectMarker();
    await wait(() => evaluate(() => document.querySelector('#event-marker-command')?.textContent.includes('Start Intake')), 'restored command');
    assert.equal(await evaluate(() => document.querySelector('#event-command-param-Setpoint').value), '42.5');
    assert.equal(await evaluate(() => document.querySelector('#event-command-param-Description').value), 'Discovery parameters');
    check('saved typed command and exact project bookmark restore');
    await pointer('.library-tabs button', 'Routines');
    await pointer('[data-id="command-step"] .rt-step-body');
    inspectionMode = 'failure'; await pointer('.labview-inspection button');
    await wait(() => evaluate(() => [...document.querySelectorAll('[role="alert"]')].some((el) => el.textContent.includes('LabVIEW inspection unavailable.'))), 'routine inspection failure'); await shot('routine-inspection-failure');
    inspectionMode = 'normal'; await pointer('.labview-inspection button');
    await wait(() => evaluate(() => ![...document.querySelectorAll('[role="alert"]')].some((el) => el.textContent.includes('LabVIEW inspection unavailable.'))), 'routine retry'); await shot('routine-typed-command');
    check('populated routine branch shares typed commands and displays inspection failure/retry');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, errors,
      note: 'Built product renderer and preload; actual disk discovery and NI-inspected catalog. Pending/failure/retry IPC states are controlled fixtures; no robot transport.' }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error); if (win) await shot('failure').catch(() => {});
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'failed', checks, errors, error: String(error.stack || error) }, null, 2));
    app.exit(1);
  }
});
