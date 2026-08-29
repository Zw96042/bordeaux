const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const output = process.env.BORDEAUX_OPTIMIZER_UI_OUTPUT;
const html = process.env.BORDEAUX_OPTIMIZER_UI_HTML;
const fixture = JSON.parse(Buffer.from(process.env.BORDEAUX_OPTIMIZER_UI_PROJECT, 'base64').toString('utf8'));
let saved = structuredClone(fixture);
let saveCount = 0;
const checks = [];
const errors = [];
const knownConsoleWarnings = [];
app.setPath('userData', path.join(output, 'user-data'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
ipcMain.handle('optimizer-ui:restore', () => ({ project: structuredClone(saved) }));
ipcMain.handle('optimizer-ui:save', (_event, project) => { saved = structuredClone(project); saveCount += 1; return { saved: true }; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
async function evaluate(fn, ...args) {
  return window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
}
async function waitFor(fn, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function click(selector, text) {
  await waitFor(() => evaluate((selector, text) => {
    const button = [...document.querySelectorAll(selector)].find((item) => text == null || item.textContent.trim() === text);
    return Boolean(button && !button.disabled && !button.closest('[inert]') && button.checkVisibility());
  }, selector, text), `an available ${text || selector} control`);
  await evaluate((selector, text) => {
    const button = [...document.querySelectorAll(selector)].find((item) => text == null || item.textContent.trim() === text);
    if (!button || button.disabled || button.closest('[inert]') || !button.checkVisibility()) throw new Error(`Cannot activate ${selector}: ${text || ''}`);
    button.click();
  }, selector, text);
}
async function snapshot() {
  return evaluate(() => ({
    time: document.querySelector('input[aria-label="Trajectory playback position"]')?.getAttribute('max'),
    geometry: document.querySelector('svg path[stroke="#05060a"][stroke-opacity="0.75"]')?.getAttribute('d'),
    path: document.querySelector('.library-current-name')?.textContent,
    status: document.querySelector('.optimizer-outcome[role="status"]')?.textContent,
    pending: Boolean(document.querySelector('.stage-plan .fieldcol[inert]')),
  }));
}
async function ready() {
  await waitFor(async () => {
    const state = await snapshot();
    return state.time && state.geometry && !state.pending && await evaluate(() =>
      !document.querySelector('.library-structure [inert]') && !document.body.textContent.includes('Preparing trajectory'));
  }, 'the authoritative normal trajectory');
}
async function save() {
  const before = saveCount;
  await click('button[aria-label="Save project"]');
  await waitFor(() => saveCount > before, 'the mocked save to complete');
  return structuredClone(saved);
}
async function stable(expected, milliseconds, label) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const state = await snapshot();
    assert.equal(state.time, expected.time, `${label}: displayed time changed while idle`);
    assert.equal(state.geometry, expected.geometry, `${label}: geometry changed while idle`);
    await delay(150);
  }
}
async function switchPath(name) {
  await evaluate((name) => {
    const row = [...document.querySelectorAll('.library-pick')].find((item) => item.querySelector('.library-name')?.textContent === name);
    if (!row) throw new Error(`Path missing: ${name}`);
    row.click();
  }, name);
  await waitFor(async () => (await snapshot()).path === name, 'the selected path');
  await ready();
}
async function finishSearch() {
  await waitFor(() => evaluate(() => [...document.querySelectorAll('.optimizer-panel button')]
    .some((item) => item.textContent === 'Cancel')), 'the explicit search to start');
  await waitFor(() => evaluate(() => ![...document.querySelectorAll('.optimizer-panel button')]
    .some((item) => item.textContent === 'Cancel')), 'the explicit search to finish', 12_000);
  await waitFor(() => evaluate(() => [...document.querySelectorAll('.optimizer-panel button')]
    .some((item) => item.textContent === 'Apply optimized')), 'an improved candidate', 2000);
}
async function openSettings() {
  if (!await evaluate(() => document.querySelector('.optimizer-settings')?.open)) {
    await click('.optimizer-settings summary');
  }
}
async function assertCompactResult() {
  // The result replaces Cancel; wait until its Apply action is available.
  await waitFor(() => evaluate(() => {
    const primary = document.querySelector('.optimizer-main.primary');
    return primary && primary.textContent === 'Apply optimized' && !primary.disabled && primary.checkVisibility();
  }), 'the enabled Apply action', 2000);
  const state = await evaluate(() => {
    const panel = document.querySelector('.optimizer-panel');
    return {
      text: panel.innerText,
      settingsOpen: panel.querySelector('.optimizer-settings').open,
      detailsOpen: panel.querySelector('.optimizer-details')?.open,
      freedomVisible: panel.querySelector('.optimizer-corridor input').checkVisibility(),
      rows: [...panel.querySelectorAll('.optimizer-choice')].map((row) => row.getAttribute('aria-label')),
      width: panel.getBoundingClientRect().width,
    };
  });
  assert.equal(state.settingsOpen, false, 'Search settings must start collapsed');
  assert.equal(state.detailsOpen, false, 'Solver diagnostics must start collapsed');
  assert.equal(state.freedomVisible, false, 'Settings inputs must not crowd the result');
  assert.ok(state.text.trim().split(/\s+/).length <= 45, `Result panel must stay concise: ${state.text}`);
  assert.ok(!state.text.includes('Limited by'), 'Detailed physics must be hidden by default');
  assert.deepEqual(state.rows, ['Preview normal trajectory', 'Preview optimized trajectory']);
  assert.equal(state.width, 300, 'The result inspector must remain compact');
}

function check(name) { checks.push(name); console.log(`PASS ${name}`); }

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false,
      preload: path.join(__dirname, 'verify-optimizer-ui-preload.cjs') } });
  window.webContents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    if (details.message.startsWith("Loading the font 'data:font/woff2")) knownConsoleWarnings.push(details.message);
    else errors.push(details.message);
  });
  window.webContents.on('render-process-gone', (_event, details) => errors.push(`Renderer process gone: ${details.reason}`));
  try {
    await window.loadFile(html);
    await ready();
    assert.equal((await snapshot()).path, fixture.paths[0].name);
    check('normal trajectory is ready');
    assert.ok(await evaluate(() => document.querySelector('.library-rail').checkVisibility()));
    assert.equal(await evaluate(() => document.querySelectorAll('.featmove').length), 0);
    await evaluate(() => document.querySelectorAll('.featgrip')[1].focus());
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await waitFor(() => evaluate(() => document.activeElement === document.querySelectorAll('.featgrip')[2]), 'keyboard reorder focus');
    const reordered = await save();
    assert.deepEqual(reordered.paths[0].waypoints[2], fixture.paths[0].waypoints[1]);
    await evaluate(() => document.querySelectorAll('.featgrip')[2].focus());
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
    await waitFor(() => evaluate(() => document.activeElement === document.querySelectorAll('.featgrip')[1]), 'restored waypoint focus');
    assert.deepEqual((await save()).paths[0].waypoints, fixture.paths[0].waypoints);
    check('waypoints reorder from the keyboard without visible arrow buttons');
    await click('.library-tabs button', 'Routines');
    assert.ok(await evaluate(() => document.querySelector('.library-rail').checkVisibility() && !document.querySelector('.pathlib-panel')));
    check('routine and path libraries remain docked beside the field');
    await click('button', 'Settings');
    await click('.settings-general .seg-i', 'Imperial');
    await delay(250);
    await fs.writeFile(path.join(output, 'document-settings.png'), (await window.webContents.capturePage()).toPNG());
    await click('button', 'Editor');
    assert.equal(await evaluate(() => document.documentElement.dataset.units), 'imperial');
    await waitFor(() => evaluate(() => !document.querySelector('.routine-status')), 'routine preview');
    await delay(250);
    await fs.writeFile(path.join(output, 'routine-toolbar.png'), (await window.webContents.capturePage()).toPNG());
    await click('.library-tabs button', 'Paths');
    const imperialProject = await save();
    assert.equal(imperialProject.editor.unitSystem, 'imperial');
    assert.deepEqual(imperialProject.paths[0].waypoints, fixture.paths[0].waypoints);
    await evaluate(() => localStorage.setItem('bordeaux.unitSystem', 'metric'));
    await window.loadFile(html);
    await ready();
    assert.equal(await evaluate(() => document.documentElement.dataset.units), 'imperial');
    check('document units save and reopen over a different machine preference without changing geometry');
    await click('button', 'Settings');
    await click('.settings-general .seg-i', 'Metric');
    await click('button', 'Editor');
    await ready();
    const normal = await snapshot();
    await click('.optimizer-toggle');
    await finishSearch();
    check('one toolbar click opens the optimizer and runs a quick search');
    await assertCompactResult();
    check('result-first inspector keeps settings and solver details collapsed');
    await fs.writeFile(path.join(output, 'optimizer-result.png'), (await window.webContents.capturePage()).toPNG());
    await stable(normal, 1800, 'Unapplied candidate');
    let project = await save();
    assert.equal(project.paths[0].optimization?.accepted, undefined);
    check('search completion leaves selected timing and geometry unchanged');
    await click('button[aria-label="Preview optimized trajectory"]');
    const candidate = await snapshot();
    assert.ok(Number(candidate.time) < Number(normal.time), 'Candidate comparison must display faster timing');
    assert.notEqual(candidate.geometry, normal.geometry, 'Candidate comparison must show improved geometry');
    await click('.optimizer-toggle');
    await stable(normal, 250, 'Closing the comparison');
    await click('.optimizer-toggle');
    assert.equal(await evaluate(() => [...document.querySelectorAll('.optimizer-panel button')].some((item) => item.textContent === 'Cancel')), false);
    await stable(normal, 350, 'Reopening the candidate');
    await click('button[aria-label="Preview optimized trajectory"]');
    await stable(candidate, 250, 'Reopened candidate comparison');
    check('closing comparison restores selected timing and reopening keeps the result without rerunning');
    const expectedGain = Number(normal.time) - Number(candidate.time);
    const expectedGainLabel = `${expectedGain.toFixed(2)} s faster · ${(expectedGain / Number(normal.time) * 100).toFixed(1)}%`;
    await waitFor(async () => (await snapshot()).status === expectedGainLabel, 'gain and percentage against the actual normal trajectory');
    await evaluate(() => {
      const heading = document.querySelector('.optimizer-outcome[role="status"]');
      const labels = [heading.textContent];
      const observer = new MutationObserver(() => labels.push(heading.textContent));
      observer.observe(heading, { childList: true, subtree: true, characterData: true });
      window.__optimizerGainProbe = { labels, stop: () => observer.disconnect() };
    });
    await click('.optimizer-panel button', 'Apply optimized');
    await waitFor(() => evaluate(() => document.querySelector('.optimizer-toggle')?.textContent === 'Optimized'), 'the applied selection');
    const applied = await snapshot();
    assert.equal(applied.time, candidate.time);
    assert.equal(applied.geometry, candidate.geometry);
    project = await save();
    const accepted = project.paths[0].optimization.accepted;
    assert.ok(accepted?.result?.samples?.length > 0, 'Apply must persist the actual accepted artifact');
    assert.equal(Number(applied.time), accepted.result.totalTimeS, 'Displayed time must match the saved trajectory exactly');
    await stable(applied, 6500, 'Applied candidate');
    const gainLabels = await evaluate(() => {
      const probe = window.__optimizerGainProbe;
      probe.stop();
      delete window.__optimizerGainProbe;
      return probe.labels;
    });
    assert.ok(gainLabels.every((label) => label === expectedGainLabel), `Displayed gain changed while applying: ${JSON.stringify(gainLabels)}`);
    check('gain and percentage match actual normal timing and stay stable while applying');
    check('compare/apply selects and persists the exact candidate beyond the worker deadline');
    const layout = await evaluate(() => {
      const panel = document.querySelector('.optimizer-panel').getBoundingClientRect();
      const field = document.querySelector('.fieldsvg').getBoundingClientRect();
      return { panelX: panel.x, fieldRight: field.right, fieldHeight: field.height, fieldWidth: field.width, width: innerWidth, height: innerHeight };
    });
    assert.ok(layout.panelX >= layout.fieldRight - 1, 'The optimization inspector must not overlap the field');
    assert.ok(layout.fieldHeight > layout.height * 0.5, 'The comparison field must remain usable with the inspector open');
    assert.ok(layout.fieldWidth > layout.width * 0.35, 'The optimizer inspector must leave room to inspect the route');
    check('optimizer inspector preserves field space');
    await fs.writeFile(path.join(output, 'optimizer-applied.png'), (await window.webContents.capturePage()).toPNG());
    await switchPath(fixture.paths[1].name);
    await switchPath(fixture.paths[0].name);
    await stable(applied, 300, 'Path switch');
    await save();
    await window.loadFile(html);
    await ready();
    await stable(applied, 500, 'Save/reload');
    check('applied timing and geometry survive path switching and save/reload');
    await click('button', 'Settings');
    await evaluate(() => {
      const input = document.querySelector('textarea[aria-label="Robot planning notes"]');
      if (!input) throw new Error('Robot planning notes missing');
      input.focus();
    });
    await window.webContents.insertText('Cosmetic optimizer verification note');
    await click('button', 'Editor');
    project = await save();
    assert.equal(project.robot.planning.notes, 'Cosmetic optimizer verification note');
    assert.deepEqual(project.paths[0].optimization.accepted, accepted);
    await ready();
    await stable(applied, 1000, 'Cosmetic robot note');
    check('cosmetic robot notes preserve the applied selection');
    await click('.optimizer-toggle');
    await stable(applied, 700, 'Reopening an applied selection');
    assert.equal(await evaluate(() => [...document.querySelectorAll('.optimizer-panel button')].some((item) => item.textContent === 'Cancel')), false);
    assert.equal(await evaluate(() => document.querySelector('.optimizer-main')?.textContent), 'Applied');
    check('reopening an accepted result preserves it without starting a search');
    await openSettings();
    await click('.optimizer-panel button', 'Optimize all');
    await waitFor(() => evaluate(() => document.querySelector('.optimizer-batch')?.textContent.includes('2 of 2 paths searched')), 'Optimize all to finish both paths', 22_000);
    const allStatuses = await evaluate(() => [...document.querySelectorAll('.optimizer-batch button')].map((item) => item.textContent));
    assert.equal(allStatuses.length, 2);
    const failedStatus = allStatuses.find((status) => !status.includes('Ready'));
    if (failedStatus) {
      await click('.optimizer-batch button', failedStatus);
      await delay(200);
      const error = await evaluate(() => document.querySelector('.optimizer-error')?.textContent || document.querySelector('.optimizer-outcome[role="status"]')?.textContent);
      assert.fail(`${failedStatus}: ${error}`);
    }
    await stable(applied, 600, 'Optimize all');
    project = await save();
    assert.deepEqual(project.paths[0].optimization.accepted, accepted, 'Optimize all must preserve the applied artifact');
    assert.equal(project.paths[1].optimization?.accepted, undefined, 'Optimize all must leave the other path on normal');
    check('Optimize all stages each path without changing selected trajectories');
    await fs.writeFile(path.join(output, 'optimizer-all.png'), (await window.webContents.capturePage()).toPNG());
    await switchPath(fixture.paths[1].name);
    const alternateNormal = await snapshot();
    await click('.optimizer-panel button', 'Apply optimized');
    await waitFor(() => evaluate(() => document.querySelector('.optimizer-toggle')?.textContent === 'Optimized'), 'the alternate applied selection');
    await switchPath(fixture.paths[0].name);
    await click('button[aria-label="Preview normal trajectory"]');
    await stable(normal, 250, 'Primary normal comparison after path switch');
    await switchPath(fixture.paths[1].name);
    await click('button[aria-label="Preview normal trajectory"]');
    await stable(alternateNormal, 250, 'Alternate normal comparison after path switch');
    await switchPath(fixture.paths[0].name);
    await stable(applied, 250, 'Selected comparison restored on path switch');
    check('Normal comparison stays on the current path when switching between applied paths');
    await openSettings();
    await evaluate(() => {
      const input = document.querySelector('.optimizer-corridor input');
      if (!input) throw new Error('Corridor input missing');
      input.focus();
      input.select();
    });
    await window.webContents.insertText('0.30');
    await evaluate(() => {
      const input = document.querySelector('.optimizer-corridor input');
      input.blur();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    project = await save();
    assert.equal(project.paths[0].optimization.corridorM, 0.30, 'The corridor input must commit its edited value');
    await waitFor(async () => /Needs update/.test((await snapshot()).status || ''), 'explicit stale optimization status');
    project = await save();
    assert.ok(project.paths[0].optimization.accepted, 'Stale artifacts remain available for an explicit choice');
    check('changing the corridor invalidates the selection with an explicit stale state');
    await click('.library-tabs button', 'Routines');
    await waitFor(() => evaluate(() => { const play = document.querySelector('button[aria-label="Play routine"]'); return play && !play.disabled && !document.querySelector('.routine-status'); }), 'the stale selection to use current normal routine planning');
    assert.ok((await save()).paths[0].optimization.accepted, 'Routine fallback must retain the stale artifact');
    check('stale accepted selections use current normal routine playback while retaining the artifact');
    await click('.library-tabs button', 'Paths');
    await click('.optimizer-panel button', 'Use normal');
    project = await save();
    assert.equal(project.paths[0].optimization.accepted, undefined);
    await ready();
    check('Use normal removes the accepted artifact');
    await click('.library-tabs button', 'Routines');
    await waitFor(() => evaluate(() => {
      const play = document.querySelector('button[aria-label="Play routine"]');
      return play && !play.disabled && !document.querySelector('.routine-status');
    }), 'routine playback after choosing normal');
    check('choosing normal restores routine playback');
    await click('.library-tabs button', 'Paths');
    await switchPath(fixture.paths[1].name);
    await click('button', 'Settings');
    await evaluate(() => {
      const input = document.querySelector('input[aria-label="Motor free speed"]');
      if (!input) throw new Error('Motor free-speed input missing');
      input.focus();
      input.select();
    });
    await window.webContents.insertText('1000');
    await evaluate(() => {
      const input = document.querySelector('input[aria-label="Motor free speed"]');
      input.blur();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await click('button', 'Editor');
    await waitFor(async () => /Needs update/.test((await snapshot()).status || ''), 'physical robot edits to invalidate the applied trajectory');
    const currentNormalLabel = await evaluate(() => document.querySelector('button[aria-label="Preview normal trajectory"] b')?.textContent);
    assert.notEqual(currentNormalLabel, `${Number(alternateNormal.time).toFixed(2)} s`, 'Robot edits must not relabel old normal timing as current');
    project = await save();
    assert.ok(project.robot.maxSpeed < fixture.robot.maxSpeed / 2, 'The robot speed limit must be substantially lower');
    assert.equal(project.robot.driveModel.motorFreeRpm, 1000);
    assert.ok(project.paths[1].optimization.accepted, 'Robot edits retain the stale artifact for an explicit choice');
    await click('.optimizer-panel button', 'Use normal');
    await ready();
    const slowerNormal = await snapshot();
    assert.ok(Number(slowerNormal.time) > Number(alternateNormal.time) * 1.5, 'Current normal timing must reflect the slower robot');
    assert.equal(slowerNormal.geometry, alternateNormal.geometry, 'Changing robot speed must preserve the authored geometry');
    project = await save();
    assert.equal(project.paths[1].optimization.accepted, undefined);
    check('physical robot edits invalidate applied timing and regenerate the current slower normal trajectory');
    assert.deepEqual(errors, [], 'Renderer console must remain free of unexpected errors');
    check('renderer console has no unexpected errors');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, errors, knownConsoleWarnings,
      normalTimeS: Number(normal.time), optimizedTimeS: Number(applied.time), savedAcceptedTimeS: accepted.result.totalTimeS }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    if (window && !window.isDestroyed()) {
      await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(output, 'failure-dom.txt'), await evaluate(() => document.body.innerText));
    }
    await fs.writeFile(path.join(output, 'last-saved-project.json'), JSON.stringify(saved, null, 2));
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, errors, knownConsoleWarnings, failure: error.message }, null, 2));
    app.exit(1);
  }
});
