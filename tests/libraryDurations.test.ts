import { describe, expect, it, vi } from 'vitest';
import { loadRendererExport } from './helpers/loadRendererExport';

type Input = { outdatedOptimization?: boolean; id: string; key: string; path: { optimization?: { accepted: object } }; robot: object; plannerId: string };
type Selection = { id: string; status: string; seconds?: number; message?: string };
type Result = { status: string; value?: { prof: { totalTime: number }; finalTrajectory: object; acceptedTrajectory?: boolean }; fallbackReason?: string };
const create = loadRendererExport<(planner: { request(input: Input): { promise: Promise<Result>; cancel(): void } }) => {
  update(inputs: Input[], selected: Selection): void;
  getSnapshot(): Record<string, Selection>;
  cancel(): void;
}>(new URL('../src/renderer/lib/libraryDurations.js', import.meta.url), 'createLibraryDurations', { replacements: [['export function createLibraryDurations(planner)', 'window.createLibraryDurations = function(planner)']] });
const input = (id: string, key = id): Input => ({ id, key, path: {}, robot: {}, plannerId: 'profiledSpline' });
const success = (seconds: number): Result => ({ status: 'success', value: { prof: { totalTime: seconds }, finalTrajectory: {} } });
function setup() {
  const jobs: { id: string; resolve(result: Result): void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const controller = create({ request(item) {
    let resolve!: (result: Result) => void;
    const promise = new Promise<Result>((done) => { resolve = done; });
    const cancel = vi.fn();
    jobs.push({ id: item.key, resolve, cancel });
    return { promise, cancel };
  } });
  return { controller, jobs };
}
const flush = () => new Promise<void>((done) => queueMicrotask(done));

describe('library trajectory durations', () => {
  it('computes unopened paths sequentially and reuses active selected duration', async () => {
    const { controller, jobs } = setup();
    controller.update([input('a'), input('b'), input('c')], { id: 'a', status: 'ready', seconds: 3 });
    expect(jobs.map((job) => job.id)).toEqual(['b']);
    expect(controller.getSnapshot().a.seconds).toBe(3);
    jobs[0].resolve(success(4)); await flush();
    expect(jobs.map((job) => job.id)).toEqual(['b', 'c']);
    jobs[1].resolve(success(5)); await flush();
    controller.update([input('a'), input('b'), input('c')], { id: 'b', status: 'pending' });
    expect(controller.getSnapshot().b.seconds).toBe(4);
    expect(jobs).toHaveLength(2);
  });

  it('invalidates edited inputs and ignores obsolete results after replacement', async () => {
    const { controller, jobs } = setup();
    controller.update([input('a'), input('b')], { id: 'a', status: 'pending' });
    controller.update([input('a'), input('b', 'new robot or shared position')], { id: 'a', status: 'pending' });
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    jobs[0].resolve(success(99)); await flush();
    expect(controller.getSnapshot().b.status).toBe('pending');
    jobs[1].resolve(success(6)); await flush();
    expect(controller.getSnapshot().b.seconds).toBe(6);
    controller.update([input('new project')], { id: 'new project', status: 'ready', seconds: 2 });
    expect(Object.keys(controller.getSnapshot())).toEqual(['new project']);
  });

  it('cancels newly selected background work and ignores completion after unmount', async () => {
    const { controller, jobs } = setup();
    const inputs = [input('a'), input('b'), input('c')];
    controller.update(inputs, { id: 'a', status: 'ready', seconds: 3 });
    controller.update(inputs, { id: 'b', status: 'pending' });
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    expect(jobs[1].id).toBe('c');
    controller.cancel();
    expect(jobs[1].cancel).toHaveBeenCalledOnce();
    jobs[1].resolve(success(100)); await flush();
    expect(controller.getSnapshot().c.status).toBe('pending');
    expect(jobs).toHaveLength(2);
  });

  it('uses the freshly planned normal duration when the applied optimization predates the current inputs', async () => {
    const { controller, jobs } = setup();
    const edited = input('b', 'edited path');
    edited.path.optimization = { accepted: {} };
    edited.outdatedOptimization = true;
    controller.update([input('a'), edited], { id: 'a', status: 'ready', seconds: 3 });
    jobs[0].resolve(success(4.25)); await flush();
    expect(controller.getSnapshot().b).toEqual({ status: 'ready', seconds: 4.25 });
  });

  it('reports failures without retry loops or blocking later paths; rejects stale accepted fallback', async () => {
    const { controller, jobs } = setup();
    const stale = input('c'); stale.path.optimization = { accepted: {} };
    const inputs = [input('a'), input('b'), stale];
    controller.update(inputs, { id: 'a', status: 'ready', seconds: 3 });
    jobs[0].resolve({ status: 'failure', fallbackReason: 'Unreachable speed' }); await flush();
    expect(controller.getSnapshot().b).toEqual({ status: 'error', message: 'Unreachable speed' });
    jobs[1].resolve(success(5)); await flush();
    expect(controller.getSnapshot().c.status).toBe('error');
    controller.update(inputs, { id: 'a', status: 'ready', seconds: 3 });
    expect(jobs).toHaveLength(2);
  });
});
