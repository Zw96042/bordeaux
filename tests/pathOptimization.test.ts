import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CorridorCorpus } from "../src/electron/benchmark/corridor";
// @ts-expect-error Production renderer module is JavaScript.
import { FinalPlanning } from "../src/renderer/assets/final-planning";
// @ts-expect-error Production renderer module is JavaScript.
import { PathOptimization } from "../src/renderer/assets/path-optimization";
// @ts-expect-error Production renderer module is JavaScript.
import { processPathPreviewJob } from "../src/renderer/assets/path-preview-worker";
// @ts-expect-error Production renderer module is JavaScript.
import { PM } from "../src/renderer/lib/pathMath";
import { optimizeCorridorFinal } from "../src/shared/planners/corridorFinal";
import { createDemoProject } from "../src/shared/project/defaults";
import { decodeProjectFile } from "../src/shared/project/fileFormat";

class FakeWorker {
  readonly jobs: Array<{ id: number }> = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(job: { id: number }) { this.jobs.push(job); }
  reply(data: unknown) { this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}

function setup() {
  let project = createDemoProject();
  const jobs: Array<{ input: any; options: any; resolve: (value: any) => void; canceled: boolean }> = [];
  const planner = {
    request(input: any, options: any) {
      let resolve!: (value: any) => void;
      const promise = new Promise((done) => { resolve = done; });
      const job = { input, options, resolve, canceled: false };
      jobs.push(job);
      return { promise, cancel() { job.canceled = true; resolve({ status: 'canceled' }); } };
    },
  };
  const session = PathOptimization.create({ getProject: () => project, planner });
  return { session, jobs, project, replace(next: typeof project) { project = next; session.sync(); } };
}

const preview = { prof: { totalTime: 3.7 }, finalTrajectory: { totalTimeS: 3.7 } };

// One real optimizer run through the worker, recorded at a fixed work budget
// and replayed into FinalPlanning as the worker would have posted it.
let recorded: { project: any; messages: any[]; final: any; projections: number } | undefined;
function recordedSearch() {
  if (recorded) return recorded;
  const directory = new URL("../benchmarks/planner-corpus/v1/", import.meta.url);
  const corpus = CorridorCorpus.loadV1(fileURLToPath(directory));
  const project = decodeProjectFile(readFileSync(new URL("corpus.bordeaux.json", directory), "utf8")).project;
  const path = project.paths.find((candidate) => candidate.id === corpus.cases[1].pathId)!;
  const messages: any[] = [];
  let projections = 0;
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    const final = processPathPreviewJob(
      { id: 1, quality: "final", optimize: true, path, robot: project.robot, perSegment: 56, deadline: "common", deadlineMs: 5_000 },
      (...args: unknown[]) => { projections += 1; return PM.derivePath(...args); },
      optimizeCorridorFinal,
      undefined,
      (message: unknown) => messages.push(message),
    );
    recorded = { project: { ...project, paths: [path] }, messages, final, projections };
  } finally {
    clock.mockRestore();
  }
  return recorded;
}

describe('explicit path optimization ownership', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps idle completion separate from project selection', async () => {
    const { session, project, jobs } = setup();
    const before = structuredClone(project);
    const pending = session.start(project.paths[0].id);
    expect(jobs[0].input.optimize).toBe(true);
    expect(session.getSnapshot().paths[project.paths[0].id].value).toBeNull();
    jobs[0].resolve({ status: 'success', value: preview });
    await pending;
    expect(session.getSnapshot().paths[project.paths[0].id].value).toEqual(preview);
    expect(project).toEqual(before);
    session.sync();
    expect(session.getSnapshot().paths[project.paths[0].id].value).toEqual(preview);
    expect(jobs).toHaveLength(1);
  });

  it('cancels changed input and rejects a stale successful reply', async () => {
    const { session, project, jobs, replace } = setup();
    const pending = session.start(project.paths[0].id);
    const changed = structuredClone(project);
    changed.robot.maxSpeed += 0.5;
    replace(changed);
    expect(jobs[0].canceled).toBe(true);
    await pending;
    expect(session.getSnapshot().paths[project.paths[0].id]).toMatchObject({ status: 'stale', value: null });
  });

  it('does not cancel for a cosmetic rename', async () => {
    const { session, project, jobs, replace } = setup();
    const pending = session.start(project.paths[0].id);
    const renamed = structuredClone(project);
    renamed.paths[0].name = 'Renamed';
    replace(renamed);
    expect(jobs[0].canceled).toBe(false);
    jobs[0].resolve({ status: 'success', value: preview });
    await pending;
    expect(session.getSnapshot().paths[project.paths[0].id].status).toBe('success');
  });

  it('keeps a deadline incumbent available to compare without changing selected data', async () => {
    const { session, project, jobs } = setup();
    const pending = session.start(project.paths[0].id);
    jobs[0].resolve({ status: 'timeout', incumbent: preview, fallbackReason: 'Deadline reached' });
    await pending;
    expect(session.getSnapshot().paths[project.paths[0].id]).toMatchObject({ status: 'timeout', value: preview });
    expect(project.paths[0].optimization?.accepted).toBeUndefined();
  });

  it.each(['canceled', 'timeout'] as const)('keeps worker progress out of the store but reports the last incumbent when %s', async (ending) => {
    vi.useFakeTimers();
    const project = createDemoProject();
    const worker = new FakeWorker();
    const planner = FinalPlanning.create({ workerFactory: () => worker, deadlines: { common: 50 } });
    const session = PathOptimization.create({ getProject: () => project, planner });
    let notifications = 0;
    session.subscribe(() => { notifications += 1; });
    const id = project.paths[0].id;
    const pending = session.start(id);
    const searching = notifications;
    const improved = { ...preview, prof: { totalTime: 3.2 } };
    worker.reply({ id: worker.jobs[0].id, type: 'progress', value: preview });
    worker.reply({ id: worker.jobs[0].id, type: 'progress', value: improved });

    expect(notifications).toBe(searching);
    expect(session.getSnapshot().paths[id]).toMatchObject({ status: 'searching', value: null });
    if (ending === 'canceled') session.cancel();
    else await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(worker.terminated).toBe(true);
    expect(session.getSnapshot().paths[id]).toMatchObject({ status: ending, value: improved });
    expect(project.paths[0].optimization?.accepted).toBeUndefined();
  });

  it.each([
    ['canceled', 'cancelled'],
    ['timeout', 'time-budget'],
    ['success', 'work-budget'],
  ] as const)('keeps the last validated route with current search counters when %s', async (ending, termination) => {
    const { project, messages, final, projections } = recordedSearch();
    const progress = messages.filter((message) => message.type === 'progress');
    const statistics = messages.filter((message) => message.type === 'statistics');
    const counters = final.value.finalOptimization;
    // Statistics never project a preview or carry a trajectory.
    expect(projections).toBe(progress.length + 1);
    expect(statistics.length).toBeGreaterThan(0);
    statistics.forEach((message) => expect(message.value).toBeUndefined());
    expect(messages.at(-1).type).toBe('statistics');
    const last = progress.at(-1).value;
    expect(last.finalOptimization.evaluations).toBeLessThan(counters.evaluations);

    vi.useFakeTimers();
    const worker = new FakeWorker();
    const planner = FinalPlanning.create({ workerFactory: () => worker, deadlines: { common: 50 } });
    const session = PathOptimization.create({ getProject: () => project, planner });
    let notifications = 0;
    session.subscribe(() => { notifications += 1; });
    const id = project.paths[0].id;
    const pending = session.start(id);
    const searching = notifications;
    messages.forEach((message) => worker.reply({ ...message, id: worker.jobs[0].id }));
    expect(notifications).toBe(searching);

    if (ending === 'canceled') session.cancel();
    else if (ending === 'timeout') await vi.advanceTimersByTimeAsync(2_000);
    else worker.reply({ ...final, id: worker.jobs[0].id });
    await pending;

    const value = session.getSnapshot().paths[id].value;
    expect(session.getSnapshot().paths[id].status).toBe(ending);
    expect(value.finalOptimization).toMatchObject({
      termination,
      evaluations: counters.evaluations,
      validatedCandidates: counters.validatedCandidates,
      rejectedCandidates: counters.rejectedCandidates,
      rejectionReasons: counters.rejectionReasons,
    });
    expect(value.finalTrajectory.optimization).toBe(value.finalOptimization);
    if (ending === 'success') {
      expect(value).toBe(final.value);
    } else {
      // The retained route is the last validated incumbent, shared rather than copied.
      expect(value.finalTrajectory.samples).toBe(last.finalTrajectory.samples);
      expect(value.finalTrajectory.optimizedPath).toBe(last.finalTrajectory.optimizedPath);
      expect(value.finalOptimization).toMatchObject({
        status: 'feasible',
        totalTimeS: last.finalOptimization.totalTimeS,
        gainS: last.finalOptimization.gainS,
      });
      expect(last.finalOptimization.termination).toBeUndefined();
    }
    expect(project.paths[0].optimization?.accepted).toBeUndefined();
  }, 30_000);

  it('queues Optimize all one path at a time and never applies batch results', async () => {
    const { session, project, jobs } = setup();
    project.paths = [project.paths[0], { ...structuredClone(project.paths[0]), id: 'second' }];
    const pending = session.startAll();
    expect(jobs).toHaveLength(1);
    jobs[0].resolve({ status: 'success', value: preview });
    await Promise.resolve(); await Promise.resolve();
    expect(jobs).toHaveLength(2);
    jobs[1].resolve({ status: 'success', value: preview });
    await pending;
    expect(session.getSnapshot().batch).toEqual({ completed: 2, total: 2 });
    expect(project.paths.every((path) => !path.optimization?.accepted)).toBe(true);
  });
});
