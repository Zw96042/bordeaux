// Exercise production main-process close/quit wiring without running an installer.
const { app, BrowserWindow, Menu, autoUpdater } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const result = { closed: false, quit: false, installing: false, dirty: false, cleanupPasses: 0, saveAvailable: false };
const output = process.env.BORDEAUX_SMOKE_DIRECTORY;
assert.ok(output, 'An isolated fixture directory is required');
Object.defineProperty(app, 'isPackaged', { value: true });
app.getVersion = () => require('../package.json').version;
const realTimeout = global.setTimeout;
// Keep native timers intact except the controller's one-minute recovery deadline.
global.setTimeout = (callback, ms, ...args) => realTimeout(callback, ms === 60_000 ? 20 : ms, ...args);
const updater = new EventEmitter();
updater.setFeedURL = () => {};
updater.checkForUpdates = async () => {};
updater.downloadUpdate = async () => { updater.emit('update-downloaded', { version: '99.0.0' }); };
updater.quitAndInstall = () => {
  // Model the native macOS handoff: notification, window closure, then app quit.
  // Changing dirty after the request also covers the old asynchronous close race.
  setImmediate(async () => {
    try {
      const window = BrowserWindow.getAllWindows()[0];
      const state = await window.webContents.executeJavaScript('window.bordeauxAPI.setDirty(true); window.bordeauxAPI.getAppUpdateState()');
      result.dirty = state.projectDirty;
      result.installing = state.phase === 'installing';
      await new Promise(resolve => realTimeout(resolve, 50));
      const stalled = await window.webContents.executeJavaScript('window.bordeauxAPI.getAppUpdateState()');
      assert.equal(stalled.installStalled, true);
      const send = window.webContents.send.bind(window.webContents);
      window.webContents.send = (channel, payload) => {
        if (channel === 'menu-command' && payload.command === 'save-project') result.saveAvailable = true;
        else send(channel, payload);
      };
      const fileMenu = Menu.getApplicationMenu().items.find(item => item.label === 'File');
      fileMenu.submenu.items.find(item => item.label === 'Save').click();
      window.webContents.send = send;
      assert.equal(result.saveAvailable, true, 'Stalled update must allow the real Save menu command');
      autoUpdater.emit('before-quit-for-update');
      const closed = new Promise(resolve => window.once('closed', resolve));
      window.close();
      await Promise.race([closed, new Promise(resolve => realTimeout(resolve, 1000))]);
      assert.ok(window.isDestroyed(), 'The installer must be allowed to close the window');
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
};
const updaterModule = require.resolve('electron-updater');
require(updaterModule);
require.cache[updaterModule].exports = { autoUpdater: updater };
app.on('browser-window-created', (_event, window) => {
  window.once('closed', () => { result.closed = true; });
  window.webContents.once('did-finish-load', async () => {
    try {
      updater.emit('update-available', { version: '99.0.0' });
      await window.webContents.executeJavaScript('window.bordeauxAPI.downloadAppUpdate()');
      await window.webContents.executeJavaScript('window.bordeauxAPI.installAppUpdate()');
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../dist-electron/electron/main.js');
app.on('will-quit', () => { result.cleanupPasses++; });
app.on('quit', () => {
  result.quit = true;
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result));
});
