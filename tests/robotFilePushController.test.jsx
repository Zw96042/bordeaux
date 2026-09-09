import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [], cursor: 0, effects: [], cleanups: [] }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState(initial) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef(initial) {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect(effect, dependencies = []) {
    const index = hooks.cursor++;
    const previous = hooks.values[index];
    if (!previous || dependencies.some((value, item) => value !== previous[item])) hooks.effects.push(effect);
    hooks.values[index] = dependencies;
  },
}));
import { useRobotFilePushController } from '../src/renderer/components/useRobotFilePushController';
import { DEFAULT_ROBOT_PATH_DIRECTORY } from '../src/shared/robotFileDelivery';
const connection = { endpoint: { host: 'robot.local', port: 22, directory: DEFAULT_ROBOT_PATH_DIRECTORY }, hostKeyFingerprint: 'SHA256:test' };
const preview = { operationId: 'one', connection, files: [{ pathId: 'A', name: 'A', fileName: 'A.bdx', size: 64, sha256: 'abc' }] };
let bridge, project, props;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function render() {
  hooks.cursor = 0;
  const controller = useRobotFilePushController(props);
  for (const effect of hooks.effects.splice(0)) { const cleanup = effect(); if (cleanup) hooks.cleanups.push(cleanup); }
  return controller;
}
beforeEach(() => {
  hooks.values = []; hooks.effects = []; hooks.cleanups = [];
  project = { paths: [{ id: 'A', name: 'Original' }], routines: [] };
  props = { getProject: () => project, projectKey: 'project', catalogKey: 'catalog' };
  bridge = { getRobotFileConnection: vi.fn(async () => connection), prepareRobotFiles: vi.fn(async () => preview),
    confirmRobotFiles: vi.fn(async () => ({ state: 'transferred', files: preview.files, directory: connection.endpoint.directory })),
    cancelRobotFiles: vi.fn(async () => ({ canceled: true })), probeRobotFiles: vi.fn(async () => connection), trustRobotFiles: vi.fn(async () => connection) };
  vi.stubGlobal('window', { bordeauxAPI: bridge }); vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('requestAnimationFrame', (callback) => callback());
});
afterEach(() => { for (const cleanup of hooks.cleanups) cleanup(); vi.unstubAllGlobals(); });
const ready = async () => { render(); await Promise.resolve(); return render(); };
const prepare = async () => { const c = await ready(); await c.requestPush({ kind: 'paths', pathIds: ['A'] }); return render(); };
describe('SFTP file push controller', () => {
  it('loads the saved endpoint without probing or transmitting', async () => {
    const c = await ready(); expect(c.connection).toEqual(connection); expect(c.directory).toBe(DEFAULT_ROBOT_PATH_DIRECTORY);
    expect(bridge.probeRobotFiles).not.toHaveBeenCalled(); expect(bridge.prepareRobotFiles).not.toHaveBeenCalled();
    expect(c.itemStatus('path', 'A')).toMatchObject({ label: 'Local' });
  });
  it('captures selected path IDs and project values before asynchronous preparation', async () => {
    const pending = deferred(); bridge.prepareRobotFiles.mockReturnValue(pending.promise);
    const c = await ready(); const selection = ['A']; const work = c.requestPush({ kind: 'paths', pathIds: selection });
    project.paths[0].name = 'Edited'; selection.push('B');
    await Promise.resolve(); pending.resolve(preview); await work;
    expect(bridge.prepareRobotFiles).toHaveBeenCalledWith({ paths: [{ id: 'A', name: 'Original' }], routines: [] }, ['A']);
    expect(render().phase).toBe('review'); expect(bridge.confirmRobotFiles).not.toHaveBeenCalled();
  });
  it('keeps confirmation locked until the upload promise settles', async () => {
    const pending = deferred(); bridge.confirmRobotFiles.mockReturnValue(pending.promise);
    const c = await prepare(); const work = c.confirmPush(); await c.confirmPush();
    await c.requestPush({ kind: 'paths', pathIds: ['B'] });
    expect(bridge.confirmRobotFiles).toHaveBeenCalledTimes(1); expect(bridge.prepareRobotFiles).toHaveBeenCalledTimes(1);
    pending.resolve({ state: 'transferred', files: preview.files }); await work;
    expect(render().phase).toBe('transferred');
  });
  it('invalidates reviewed files after catalog changes', async () => {
    await prepare(); props = { ...props, catalogKey: 'changed' }; render();
    expect(render().preview).toBeNull(); expect(bridge.cancelRobotFiles).toHaveBeenCalledWith('one');
  });
  it('surfaces failed preparation and supports a fresh retry', async () => {
    bridge.prepareRobotFiles.mockRejectedValueOnce(new Error('Path cannot be exported'));
    await prepare(); const c = render(); expect(c.phase).toBe('failed'); expect(c.error).toBe('Path cannot be exported');
    await c.retry(); expect(render().phase).toBe('review');
  });
  it('keeps upload busy after a cancellation request until RPC settles', async () => {
    const pending = deferred(); bridge.confirmRobotFiles.mockReturnValue(pending.promise);
    const c = await prepare(); const work = c.confirmPush(); await c.cancel();
    expect(render().busy).toBe(true); await c.requestPush({ kind: 'paths', pathIds: ['B'] });
    expect(bridge.prepareRobotFiles).toHaveBeenCalledTimes(1);
    pending.reject(new Error('Upload canceled')); await work;
    expect(render().phase).toBe('failed'); expect(render().error).toBe('Upload canceled');
  });
  it.each(['routine', 'project'])('does not prepare unsupported %s delivery', async (kind) => {
    const c = await ready(); await c.requestPush({ kind });
    expect(render().phase).toBe('unsupported'); expect(bridge.prepareRobotFiles).not.toHaveBeenCalled();
  });
  it('continues pending selection when the saved connection arrives late', async () => {
    const pending = deferred(); bridge.getRobotFileConnection.mockReturnValue(pending.promise);
    const c = render(); await c.requestPush({ kind: 'paths', pathIds: ['A'] });
    pending.resolve(connection); await Promise.resolve(); await Promise.resolve();
    expect(bridge.prepareRobotFiles).toHaveBeenCalledOnce(); expect(render().phase).toBe('review');
  });
});
