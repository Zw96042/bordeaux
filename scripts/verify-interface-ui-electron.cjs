const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.env.BORDEAUX_INTERFACE_UI_OUTPUT;
app.setPath('userData', path.join(output, 'user-data'));
let win;
const errors = [], checks = [];
const delay = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function click(selector, text) {
  const p = await evaluate((selector, text) => {
    const el = [...document.querySelectorAll(selector)].find((el) => !text || el.textContent.trim() === text);
    if (!el || el.disabled) throw Error('Missing control ' + selector);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    if (!el.contains(document.elementFromPoint(x, y))) throw Error('Obscured ' + selector);
    return { x, y };
  }, selector, text);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 }); await delay();
}
async function key(keyCode, modifiers = []) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await delay(); }
async function replace(text) { await key('Home'); await key('End', ['shift']); await win.webContents.insertText(text); await delay(); }
async function snap(name) { await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); }
const check = (name) => { checks.push(name); console.log('PASS ' + name); };
app.whenReady().then(async () => {
  try {
    win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true } });
    win.webContents.on('console-message', (d) => { if (d.level === 'error' && !d.message.startsWith("Loading the font 'data:")) errors.push(d.message); });
    await win.loadFile(path.join(output, 'dist/index.html')); await delay(250);
    await click('#search-choice'); await win.webContents.insertText('Option 10'); await key('Down');
    assert.equal(await evaluate(() => document.activeElement.id), 'search-choice-search');
    assert.equal(await evaluate(() => document.querySelector('.cmd-picker-option.active').dataset.value), '100');
    await win.webContents.insertText('1'); await key('Down'); await key('Enter');
    assert.equal(await evaluate(() => document.querySelector('#search-choice-value').textContent), 'Option 101');
    assert.equal(await evaluate(() => document.activeElement.id), 'search-choice');
    check('Search retains caret across arrow navigation and accepts the filtered result');
    await click('#search-choice'); await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.id), 'search-choice-custom');
    await win.webContents.insertText('custom-result'); await key('Tab');
    assert.equal(await evaluate(() => document.activeElement.textContent), 'Use');
    await key('Enter'); assert.equal(await evaluate(() => document.querySelector('#search-choice-value').textContent), 'custom-result');
    await click('#search-choice'); await key('Tab', ['shift']);
    assert.equal(await evaluate(() => Boolean(document.querySelector('.dropdown-panel'))), false);
    check('Custom values and picker exit work with Tab and Shift+Tab');
    await click('#short-choice'); await key('End'); await key('Space');
    assert.equal(await evaluate(() => document.querySelector('#short-choice-value').textContent), 'Gamma');
    await click('#short-choice'); await key('Home'); await key('Enter');
    assert.equal(await evaluate(() => document.querySelector('#short-choice-value').textContent), 'Alpha');
    await click('#short-choice'); await key('B'); await key('Enter');
    assert.equal(await evaluate(() => document.querySelector('#short-choice-value').textContent), 'Beta');
    assert.equal(await evaluate(() => document.querySelector('#unknown-choice-value').textContent), 'retired-value');
    check('Short choices support Home/End, Space and typeahead; unavailable values remain readable');
    await click('.numlbl');
    assert.equal(await evaluate(() => document.activeElement.className), 'numinput');
    await replace('invalid'); await key('Enter');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-invalid')), 'true');
    await key('Escape'); await key('Enter');
    assert.equal(await evaluate(() => document.querySelector('#canonical-width').textContent), '0.8128');
    await click('#parameter'); await replace(''); await key('Enter');
    assert.equal(await evaluate(() => document.activeElement.id), 'parameter');
    assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-invalid')), 'true');
    await key('Escape'); assert.equal(await evaluate(() => document.querySelector('#parameter').value), '2');
    check('Invalid Enter retains numeric focus; Escape restores the exact saved value');
    await click('#routine-command-param-amount'); await replace(''); await key('Enter');
    assert.equal(await evaluate(() => document.querySelector('#routine-command-param-amount').getAttribute('aria-invalid')), 'true');
    await click('#select-b');
    assert.equal(await evaluate(() => document.querySelector('#routine-command-param-amount').value), '2');
    assert.equal(await evaluate(() => document.querySelector('#routine-command-param-amount').getAttribute('aria-invalid')), 'false');
    check('Invalid command drafts do not leak to a different routine command');
    await click('#search-choice'); await win.webContents.insertText('Option 10'); await key('Down');
    await snap('controls-1440'); win.setContentSize(1100, 720); await delay(); await snap('controls-1100');
    const bounds = await evaluate(() => { const r = document.querySelector('.dropdown-panel').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; });
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height);
    await key('Escape');
    assert.notEqual(await evaluate(() => getComputedStyle(document.querySelector('.robot-push-spinner')).animationName), 'none');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.robot-push-spinner')).animationName), 'none');
    await snap('reduced-motion-1100');
    check('Dropdown stays within the smaller viewport; reduced motion keeps static status');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  } catch (e) { console.error(e, errors); if (win) await snap('failure'); process.exitCode = 1; }
  finally { win?.destroy(); app.exit(process.exitCode || 0); }
});
