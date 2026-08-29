import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = (process.env.BORDEAUX_OPTIMIZER_UI_OUTPUT && path.resolve(process.env.BORDEAUX_OPTIMIZER_UI_OUTPUT)) || await fs.mkdtemp(path.join(os.tmpdir(), 'bordeaux-optimizer-ui-'));
await fs.mkdir(output, { recursive: true });
const corpus = JSON.parse(await fs.readFile(path.join(root, 'benchmarks/planner-corpus/v1/corpus.bordeaux.json'), 'utf8'));
const primary = structuredClone(corpus.paths.find((item) => item.id === 'corpus-neutral-slalom'));
if (!primary) throw new Error('Neutral slalom verification fixture was not found');
primary.name = 'Optimizer verification slalom';
const alternate = { ...structuredClone(corpus.paths.find((item) => item.id === 'corpus-neutral-stop')), id: 'optimizer-verification-alternate', name: 'Optimizer verification alternate' };
const fixture = { ...corpus, name: 'Optimizer UI verification', paths: [primary, alternate], pathLinks: [],
  routines: [{ id: 'optimizer-verification-routine', name: 'Verification', nodes: [{ id: 'optimizer-drive', type: 'path', ref: primary.id }] }],
  activeRoutineId: 'optimizer-verification-routine', plannerId: 'profiledSpline', editor: { activePathId: primary.id } };
const html = path.join(root, 'dist-renderer/index.html');
await fs.access(html);
const env = { ...process.env, BORDEAUX_OPTIMIZER_UI_OUTPUT: output, BORDEAUX_OPTIMIZER_UI_HTML: html,
  BORDEAUX_OPTIMIZER_UI_PROJECT: Buffer.from(JSON.stringify(fixture)).toString('base64'), ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
delete env.ELECTRON_RUN_AS_NODE;
console.log(`Optimizer UI verification artifacts: ${output}`);
const child = spawn(electron, [path.join(root, 'scripts/verify-optimizer-ui-electron.cjs')], { cwd: root, env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGKILL'), 150_000);
child.on('error', (error) => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) console.error(`Optimizer UI verification terminated: ${signal}`);
  process.exitCode = code === 0 ? 0 : 1;
});
