const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.BORDEAUX_UPDATES_UI_OUTPUT;
const checks = [], errors = [];
app.setPath('userData', path.join(output, 'user-data'));
let win;
const delay = ms => new Promise(r => setTimeout(r, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`);
async function waitFor(fn, label) { for (let i = 0; i < 60; i++) { if (await fn()) return; await delay(50); } throw new Error('Timed out: ' + label); }
async function click(selector, text) {
  const point = await evaluate((selector, text) => {
    const target = [...document.querySelectorAll(selector)].find(node => !text || node.textContent.trim() === text);
    if (!target || target.disabled) throw new Error('Unavailable ' + selector + ' ' + text);
    target.scrollIntoView({ block: 'nearest' });
    const b = target.getBoundingClientRect(), x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
    if (!target.contains(document.elementFromPoint(x, y))) throw new Error('Obscured target');
    return { x, y };
  }, selector, text);
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await delay(70);
}
async function key(keyCode, modifiers = []) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(70); }
async function set(patch) { await evaluate(patch => window.__updateFixture.set(patch), patch); await delay(70); }
const rect = () => evaluate(() => { const b = document.querySelector('dialog').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
async function capture(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
function pass(name) { checks.push(name); console.log('PASS ' + name); }
app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  try {
    await win.loadFile(path.join(output, 'dist/index.html'));
    await waitFor(() => evaluate(() => !!document.querySelector('#update-trigger')), 'fixture');
    for (const platform of ['darwin', 'win32']) for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height);
      await evaluate(platform => { window.bordeauxAPI.platform = platform; window.__updateFixture.calls.length = 0; }, platform);
      await set({ phase: 'idle', visible: false, version: null, releaseNotes: '', projectDirty: false });
      await click('#update-trigger');
      const initial = await rect();
      await click('dialog button', 'Check for updates');
      assert.ok(await evaluate(() => document.querySelector('progress')?.getAttribute('aria-label') === 'Checking for updates'));
      await capture(`${platform}-${width}-checking`);
      await set({ phase: 'error', error: 'The update request was denied. Try another network or open releases.', errorStage: 'check' });
      await click('dialog button', 'Copy details');
      assert.ok(await evaluate(() => window.__updateFixture.calls.includes('copy')));
      await capture(`${platform}-${width}-error`);
      await click('dialog button', 'Try again');
      assert.equal(await evaluate(() => window.__updateFixture.calls.filter(c => c === 'check').length), 2);
      await set({ phase: 'available', version: '0.2.0-beta.11', releaseNotes: '# Improvements\n- More consistent trajectory playback\n- Clearer project saving\n## Fixes\n' + '- Long release notes stay inside this panel.\n'.repeat(30) + '<img src=x onerror=alert(1)>\n[External](https://bad.example)' });
      assert.equal(await evaluate(() => document.querySelectorAll('.app-update-notes img,.app-update-notes a').length), 0);
      assert.ok(await evaluate(() => { const n = document.querySelector('.app-update-notes'); return n.scrollHeight > n.clientHeight; }));
      await capture(`${platform}-${width}-available`);
      await click('dialog button', 'Download update');
      await set({ progress: { percent: 43, transferred: 45 * 1048576, total: 100 * 1048576, bytesPerSecond: 2 * 1048576 } });
      assert.equal(await evaluate(() => document.querySelector('progress').value), 43);
      await capture(`${platform}-${width}-download`);
      await key('Escape');
      assert.equal(await evaluate(() => document.querySelector('dialog').open), false);
      assert.equal(await evaluate(() => document.activeElement.id), 'update-trigger');
      assert.ok(await evaluate(() => !window.__updateFixture.calls.includes('cancel')));
      await click('#update-trigger');
      await click('dialog button', 'Cancel download');
      assert.ok(await evaluate(() => window.__updateFixture.calls.includes('cancel')));
      await set({ phase: 'error', errorStage: 'download', error: 'The connection was interrupted. Try the download again.' });
      await click('dialog button', 'Retry download');
      assert.equal(await evaluate(() => window.__updateFixture.calls.filter(c => c === 'download').length), 2);
      await set({ phase: 'downloaded', projectDirty: true });
      assert.equal(await evaluate(() => [...document.querySelectorAll('dialog button')].find(b => b.textContent === 'Restart and install').disabled), true);
      await capture(`${platform}-${width}-dirty`);
      await set({ projectDirty: false });
      assert.deepEqual(await rect(), initial, 'Phase changes must not move or resize the dialog');
      await capture(`${platform}-${width}-ready`);
      await evaluate(() => document.querySelector('.app-update-close').focus());
      await key('Tab', ['shift']);
      assert.equal(await evaluate(() => document.activeElement.textContent), 'Restart and install');
      await key('Return');
      assert.ok(await evaluate(() => window.__updateFixture.calls.includes('install')));
      await key('Escape');
      assert.equal(await evaluate(() => document.querySelector('dialog').open), true, 'Installation must keep the editor blocked until quit or failure');
      pass(`${platform} ${width}×${height}: safe notes, fixed layout, retry, progress, cancel, dirty guard, modal keyboard and focus`);
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
    app.exit(0);
  } catch(error) { console.error(error); await capture('failure'); await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, errors, error: error.message }, null, 2)); app.exit(1); }
});
