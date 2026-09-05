import { describe, expect, it } from "vitest";
// @ts-expect-error Production renderer module is JavaScript.
import { PathOptimization } from "../src/renderer/assets/path-optimization";
import { createDemoProject } from "../src/shared/project/defaults";

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

describe('explicit path optimization ownership', () => {
  it('keeps idle completion and progress separate from project selection', async () => {
    const { session, project, jobs } = setup();
    const before = structuredClone(project);
    const pending = session.start(project.paths[0].id);
    expect(jobs[0].input.optimize).toBe(true);
    jobs[0].options.onProgress(preview);
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
    jobs[0].options.onProgress(preview);
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
