import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/renderer/styles/app.css';
import '../src/renderer/styles/robot-push.css';
import { RobotPushDialog, useRobotPushController } from '../src/renderer/components/RobotPushDialog';
import { DiagnosticBundleDialog } from '../src/renderer/components/DiagnosticBundleDialog';
import { DEFAULT_ROBOT_PATH_DIRECTORY } from '../src/shared/robotFileDelivery';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const results = [], root = createRoot(document.getElementById('root'));
const endpoint = { host: 'roborio-2468-frc.local', port: 22, directory: DEFAULT_ROBOT_PATH_DIRECTORY };
const connection = { endpoint, hostKeyFingerprint: 'SHA256:' + 'a'.repeat(43) };
const files = ['A', 'B'].map((id) => ({ pathId: id, name: id === 'A' ? 'Left-side scoring approach with obstacle clearance' : 'Return to pickup', fileName: id + '-path.bdx', size: 48128, sha256: 'c'.repeat(64) }));
const preview = { operationId: 'upload-1', connection, files };
let controller, props, mock;
const assert = (value, message) => { if (!value) throw new Error(message); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const action = async (fn) => act(async () => { fn(); });
const resolve = async (request, value) => act(async () => request.resolve(value));
const reject = async (request, message) => act(async () => request.reject(new Error(message)));
async function native(request) { await new Promise((resolve) => { window.__pushUiRequest = request; window.__finishPushUiRequest = () => { window.__pushUiRequest = null; resolve(); }; }); }
const button = (label) => [...document.querySelectorAll('button')].find((button) => button.textContent === label || button.getAttribute('aria-label') === label);
async function pointer(label) { const rect = button(label).getBoundingClientRect(); await act(async () => native({ pointer: { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) } })); }
function Harness() { controller = useRobotPushController(props); return <><button id="origin" onClick={() => controller.requestPush({ kind: 'paths', pathIds: ['A','B'] })}>Push selection</button><RobotPushDialog controller={controller} /><DiagnosticBundleDialog getProject={props.getProject} targetSelector=".robot-connection-diagnostics" onOpen={controller.close} renderKey={controller.open + ":" + controller.phase} /></>; }
async function mount(saved = connection) {
  await act(async () => root.render(null));
  props = { getProject: () => ({ paths: files.map((f) => ({ id: f.pathId, name: f.name })), routines: [] }), projectKey: 'project-1', catalogKey: 'catalog-1' };
  mock = { probes: [], trusts: [], prepares: [], confirms: [], canceled: [] };
  const enqueue = (name,args) => { const request = { args: structuredClone(args), ...deferred() }; mock[name].push(request); return request.promise; };
  window.bordeauxAPI = { robotDeliveryCapabilities: { fileTransfer: true, pathPush: true, routinePush: false },
    previewBetaDiagnostic: async () => ({ previewId: 'diagnostic', contents: '{}' }),
    getRobotFileConnection: async () => saved,
    probeRobotFiles: (...args) => enqueue('probes',args), trustRobotFiles: (...args) => enqueue('trusts',args),
    prepareRobotFiles: (...args) => enqueue('prepares',args), confirmRobotFiles: (...args) => enqueue('confirms',args),
    cancelRobotFiles: async (id) => { mock.canceled.push(id); return { canceled: true }; } };
  await act(async () => root.render(<Harness />));
}
async function prepare() { await pointer('Push selection'); await resolve(mock.prepares.at(-1), preview); assert(controller.phase === 'review', 'Must review immutable files'); }
async function test(name, run, saved) { try { await mount(saved); await run(); results.push({ name, ok: true }); } catch (error) { results.push({ name, ok: false, error: error.stack }); } }
await test('Pointer and keyboard connect, trust identity, review multiple files, upload and verify', async () => {
  await pointer('Push selection');
  assert(controller.directory === DEFAULT_ROBOT_PATH_DIRECTORY, 'Required default directory');
  await action(() => controller.setHost(endpoint.host));
  await native({ capture: 'connection' });
  document.querySelector('.robot-push-close').focus();
  await act(async () => native({ key: 'Tab' }));
  assert(document.activeElement.tagName === 'INPUT', 'Tab reaches robot host field');
  await pointer('Connect'); await resolve(mock.probes[0], connection);
  assert(controller.phase === 'identity', 'Identity review required');
  await native({ capture: 'identity' });
  button('Trust SSH identity').focus(); await act(async () => native({ key: 'Enter' }));
  assert(mock.trusts.length === 1, 'Keyboard trusts exactly once');
  await native({ capture: 'trust-pending' });
  await resolve(mock.trusts[0], connection); await resolve(mock.prepares[0], preview);
  assert(mock.prepares[0].args[1].join(',') === 'A,B', 'Only selected files prepared');
  assert(document.querySelector('dialog').textContent.includes(DEFAULT_ROBOT_PATH_DIRECTORY), 'Review destination is visible');
  await native({ capture: 'review' });
  await pointer('Upload 2 paths');
  await action(() => controller.confirmPush());
  assert(mock.confirms.length === 1, 'Double confirm cannot duplicate upload');
  await native({ capture: 'uploading' });
  await resolve(mock.confirms[0], { state: 'transferred', files, directory: endpoint.directory });
  await native({ capture: 'success' });
  assert(document.querySelector('dialog').textContent.includes('does not activate'), 'File success must not imply execution');
  await act(async () => native({ key: 'Escape' }));
  assert(!controller.open, 'Escape closes dialog');
  assert(document.activeElement.id === 'origin', 'Focus returns to initiating button');
}, null);
await test('Trust failure keeps reviewed identity and retry available', async () => {
  await pointer('Push selection'); await action(() => controller.setHost(endpoint.host));
  await pointer('Connect'); await resolve(mock.probes[0], connection);
  await pointer('Trust SSH identity'); await reject(mock.trusts[0], 'SSH identity changed. Reconnect and verify the host key.');
  assert(controller.phase === 'identity', 'Failure retains identity review');
  assert(document.querySelector('dialog').textContent.includes(connection.hostKeyFingerprint), 'Fingerprint remains visible');
  await native({ capture: 'identity-failure' });
}, null);
await test('Upload failure shows one error with a fresh review recovery', async () => {
  await prepare(); await pointer('Upload 2 paths'); await reject(mock.confirms[0], 'SFTP readback did not match the uploaded file.');
  assert(controller.phase === 'failed', 'Failed verification cannot report success');
  assert(document.querySelectorAll('[role="alert"]').length === 1, 'One useful error');
  await native({ capture: 'failure' });
  await pointer('Review current edits'); assert(mock.prepares.length === 2, 'Retry prepares again');
});
for (const key of ['projectKey','catalogKey','bookmarkKey']) await test('Discard stale preparation after ' + key + ' change', async () => {
  await pointer('Push selection');
  props = { ...props, [key]: 'changed' }; await act(async () => root.render(<Harness />));
  await resolve(mock.prepares[0], preview);
  assert(!controller.preview && controller.phase !== 'review', 'Stale review discarded');
  assert(mock.canceled.includes(preview.operationId), 'Stale immutable operation canceled');
});
await test('Source edits preserve reviewed snapshot while navigation preserves an in-flight upload', async () => {
  await prepare();
  await pointer('Upload 2 paths');
  props = { ...props, projectKey: 'other' }; await act(async () => root.render(<Harness />));
  await action(() => controller.requestPush({ kind: 'paths', pathIds: ['B'] }));
  assert(mock.prepares.length === 1, 'No second upload while confirmation unsettled');
  await resolve(mock.confirms[0], { state: 'transferred', files, directory: endpoint.directory });
  assert(controller.phase === 'transferred', 'Confirmed files retain exact result across navigation');
});
await test('Review cancellation and unsupported routine never upload', async () => {
  await prepare(); await pointer('Cancel'); assert(controller.phase === 'cancelled', 'Cancel ends review');
  await action(() => controller.requestPush({ kind: 'routine', routineId: 'R' }));
  assert(controller.phase === 'unsupported' && !mock.confirms.length, 'Routine cannot upload');
  await action(() => controller.requestPush({ kind: 'project' }));
  assert(controller.phase === 'unsupported' && !mock.confirms.length, 'Full replacement cannot upload');
});
await test('Connection diagnostics portal opens the real local diagnostic flow', async () => {
  await action(() => controller.openConnection());
  assert(button('Diagnostics') && !button('Diagnostics').disabled, 'Diagnostics remains reachable');
  await pointer('Diagnostics');
  assert(!controller.open && document.querySelector('.robot-diagnostics').open, 'Diagnostics opens after connection closes');
  await pointer('Generate preview');
  assert(document.querySelector('[aria-label="Read-only beta diagnostic JSON"]').value === '{}', 'Diagnostic preview remains usable');
  await native({ capture: 'diagnostics' });
});
await test('Long filename and destination remain readable at supported sizes', async () => {
  await pointer('Push selection');
  const long = { ...preview, connection: { ...connection, endpoint: { ...endpoint, directory: endpoint.directory + '/' + 'practice-session-'.repeat(8) } }, files: [{ ...files[0], fileName: 'left-scoring-approach-'.repeat(8) + '.bdx' }, files[1]] };
  await resolve(mock.prepares[0], long);
  await native({ capture: 'long-review' });
  const dialog = document.querySelector('dialog');
  assert(dialog.scrollWidth <= dialog.clientWidth + 1, 'Long metadata cannot cause horizontal clipping');
});
await act(async () => root.render(null));
const report = document.createElement('pre'); report.id = 'verification-report'; report.textContent = JSON.stringify(results, null, 2); document.body.append(report);
