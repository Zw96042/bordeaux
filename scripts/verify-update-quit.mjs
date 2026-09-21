import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';

const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bordeaux-update-quit-'));
const env = { ...process.env, BORDEAUX_SMOKE_DIRECTORY: output, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
if (process.platform === 'linux') env.APPIMAGE = path.join(output, 'Fixture.AppImage');
delete env.ELECTRON_RUN_AS_NODE;
delete env.BORDEAUX_SMOKE_TEST;
const child = spawn(electron, ['scripts/verify-update-quit-electron.cjs'], { env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
clearTimeout(timer);
if (code !== 0) throw new Error('Update quit lifecycle did not finish successfully');
const result = JSON.parse(await fs.readFile(path.join(output, 'result.json'), 'utf8'));
if (!result.closed || !result.quit || !result.installing || !result.dirty || result.cleanupPasses < 2 || !result.saveAvailable) {
  throw new Error('Update quit lifecycle incomplete: ' + JSON.stringify(result));
}
console.log('PASS Production window closes and background cleanup completes during update with unsaved edits (controlled installer handoff)');
