import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRendererExport } from "./helpers/loadRendererExport";

interface WorkerJob { id: number; quality: "interactive" | "final"; perSegment: number }
interface TransportEvent {
  phase: "request" | "result";
  source: "worker" | "direct";
  schedulerId: number;
  job: { revision: number; quality: "interactive" | "final"; perSegment: number };
}

class FakeWorker {
  readonly jobs: WorkerJob[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: ((event: { data?: unknown }) => void) | null = null;
  postError: Error | null = null;
  postMessage(job: WorkerJob) {
    if (this.postError) throw this.postError;
    this.jobs.push(job);
  }
  resolve(data: unknown) { this.onmessage?.({ data }); }
  fail(message = "worker failed") { this.onerror?.({ message }); }
  failMessage(data?: unknown) { this.onmessageerror?.({ data }); }
  terminate() { this.terminated = true; }
}

function previewModule(context: Record<string, unknown> = {}) {
  return loadRendererExport<{
    create(options: { workerFactory?: () => FakeWorker; derive?: (job: unknown) => unknown; timeoutMs?: number; transportObserver?: (event: TransportEvent) => void }): {
      request(input: { path: unknown; robot: unknown; plannerId: string; quality: "interactive" | "final"; key?: string }): number;
      getSnapshot(): { status: string; revision: number; quality: string; path: unknown; value: unknown };
      retain(): () => void;
      destroy(): void;
    };
    samplesForQuality(quality: string): number;
    directPreviewIsSafe(path: unknown, perSegment: number): boolean;
  }>(new URL("../src/renderer/assets/path-preview.js", import.meta.url), "PathPreview", {
    context: { performance, queueMicrotask, setTimeout, clearTimeout, ...context },
    replacements: [[
      "return new Worker(new URL('./path-preview-worker.js', import.meta.url), { type: 'module' });",
      "return config.workerFactory();",
    ]],
  });
}

function benchmarkEventBus(mode: "observe" | "force-direct") {
  const listeners = new Map<string, Array<(event: BenchmarkEvent) => void>>();
  const events: BenchmarkEvent[] = [];
  class BenchmarkEvent {
    constructor(readonly type: string, readonly init: { detail: unknown }) {}
    get detail() { return this.init.detail; }
  }
  const dispatchEvent = (event: BenchmarkEvent) => {
    events.push(event);
    listeners.get(event.type)?.forEach((listener) => listener(event));
    return true;
  };
  const addEventListener = (type: string, listener: (event: BenchmarkEvent) => void) => {
    const registered = listeners.get(type) ?? [];
    registered.push(listener);
    listeners.set(type, registered);
  };
  return {
    context: {
      location: { search: `?bordeauxBenchmarkTransport=${mode}&bordeauxBenchmarkWaypoint=0` },
      URLSearchParams,
      CustomEvent: BenchmarkEvent,
      dispatchEvent,
      addEventListener,
    },
    dispatch(type: string, detail: unknown) { dispatchEvent(new BenchmarkEvent(type, { detail })); },
    transportDetails() {
      return events.filter((event) => event.type === "bordeaux-benchmark:path-preview-transport").map((event) => event.detail);
    },
  };
}

describe("renderer path preview scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("does not allocate a worker until the scheduler receives work", () => {
    const worker = new FakeWorker();
    let allocations = 0;
    const preview = previewModule().create({ workerFactory: () => { allocations += 1; return worker; } });

    expect(allocations).toBe(0);
    preview.request({ path: {}, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    expect(allocations).toBe(1);
    preview.destroy();
  });

  it("observes matching application worker requests and results", () => {
    const worker = new FakeWorker();
    const transport: TransportEvent[] = [];
    const preview = previewModule().create({ workerFactory: () => worker, transportObserver: (event) => transport.push(event) });

    const revision = preview.request({ path: {}, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    worker.resolve({ id: revision, value: { rendered: true } });

    expect(transport).toEqual([
      expect.objectContaining({ phase: "request", source: "worker", job: expect.objectContaining({ revision }) }),
      expect.objectContaining({ phase: "result", source: "worker", job: expect.objectContaining({ revision }) }),
    ]);
    expect(transport[0].schedulerId).toBe(transport[1].schedulerId);
  });

  it("identifies a direct fallback without claiming worker transport", async () => {
    const transport: TransportEvent[] = [];
    const preview = previewModule().create({
      workerFactory: () => { throw new Error("worker unavailable"); },
      derive: () => ({ rendered: true }),
      transportObserver: (event) => transport.push(event),
    });

    preview.request({ path: {}, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    await Promise.resolve();

    expect(transport).toEqual([
      expect.objectContaining({ phase: "result", source: "direct" }),
    ]);
    expect(transport).not.toContainEqual(expect.objectContaining({ source: "worker" }));
  });

  it("reports optimized worker failure instead of publishing a profiled direct fallback", async () => {
    let directCalls = 0;
    const preview = previewModule().create({
      workerFactory: () => { throw new Error("worker unavailable"); },
      derive: () => { directCalls += 1; return { planner: "profiledSpline" }; },
    });

    const revision = preview.request({ path: {}, robot: {}, plannerId: "optimizedTrajectory", quality: "final" });
    await Promise.resolve();

    expect(directCalls).toBe(0);
    expect(preview.getSnapshot()).toMatchObject({ status: "error", revision });
  });

  it("summarizes timed worker transport without per-job events", () => {
    const bus = benchmarkEventBus("observe");
    const worker = new FakeWorker();
    const preview = previewModule(bus.context).create({ workerFactory: () => worker });
    bus.dispatch("bordeaux-benchmark:path-preview-transport-control", { mode: "timed-start", windowId: "latency" });

    const revision = preview.request({ path: { waypoints: [{ x: 1, y: 2 }] }, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    worker.resolve({ id: revision, value: { rendered: true } });
    bus.dispatch("bordeaux-benchmark:path-preview-transport-control", { mode: "timed-report", windowId: "latency" });

    expect(bus.transportDetails()).toEqual([{
      phase: "summary",
      windowId: "latency",
      schedulerId: expect.any(Number),
      interactiveWorkerRequests: 1,
      matchingWorkerResults: 1,
      directResults: 0,
    }]);
  });

  it("reports a timed direct fallback without emitting a false worker result", async () => {
    const bus = benchmarkEventBus("force-direct");
    const preview = previewModule(bus.context).create({ derive: () => ({ rendered: true }) });
    bus.dispatch("bordeaux-benchmark:path-preview-transport-control", { mode: "timed-start", windowId: "stress" });

    preview.request({ path: { waypoints: [{ x: 1, y: 2 }] }, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    await Promise.resolve();
    bus.dispatch("bordeaux-benchmark:path-preview-transport-control", { mode: "timed-report", windowId: "stress" });

    expect(bus.transportDetails()).toEqual([{
      phase: "summary",
      windowId: "stress",
      schedulerId: expect.any(Number),
      interactiveWorkerRequests: 0,
      matchingWorkerResults: 0,
      directResults: 1,
    }]);
  });

  it("keeps only the latest replacement while a worker job is running", () => {
    const worker = new FakeWorker();
    const module = previewModule();
    const preview = module.create({ workerFactory: () => worker });
    const input = { path: {}, robot: {}, plannerId: "profiledSpline" };

    const first = preview.request({ ...input, quality: "interactive" });
    const second = preview.request({ ...input, quality: "interactive" });
    const third = preview.request({ ...input, quality: "final" });

    expect(worker.jobs).toEqual([expect.objectContaining({ id: first, quality: "interactive", perSegment: 14 })]);
    worker.resolve({ id: first, value: { stale: true }, durationMs: 12 });
    expect(worker.jobs.map((job) => job.id)).toEqual([first, third]);
    expect(worker.jobs).not.toContainEqual(expect.objectContaining({ id: second }));
    expect(worker.jobs[1]).toMatchObject({ quality: "final", perSegment: 56 });

    worker.resolve({ id: third, value: { fresh: true }, durationMs: 8 });
    expect(preview.getSnapshot()).toMatchObject({
      status: "ready",
      revision: third,
      quality: "final",
      value: { fresh: true },
    });
    expect(module.samplesForQuality("final")).toBe(56);
    preview.destroy();
    expect(worker.terminated).toBe(true);
  });

  it("retains exact source provenance until its replacement completes", () => {
    const worker = new FakeWorker();
    const preview = previewModule().create({ workerFactory: () => worker });
    const firstPath = { id: "same-id", waypointX: 0 };
    const secondPath = { id: "same-id", waypointX: 10 };
    const first = preview.request({ path: firstPath, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: firstPath.id });
    worker.resolve({ id: first, value: { waypointX: 0 }, durationMs: 1 });

    preview.request({ path: secondPath, robot: {}, plannerId: "profiledSpline", quality: "final", key: secondPath.id });

    expect(preview.getSnapshot()).toMatchObject({
      status: "pending",
      key: firstPath.id,
      path: firstPath,
      value: { waypointX: 0 },
    });
    expect(preview.getSnapshot().path).not.toBe(secondPath);
  });

  it("publishes completed geometry while a newer drag request is queued", () => {
    const worker = new FakeWorker();
    const preview = previewModule().create({ workerFactory: () => worker });
    const firstPath = { id: "path", x: 1 };
    const nextPath = { id: "path", x: 2 };
    const first = preview.request({ path: firstPath, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: firstPath.id });
    preview.request({ path: nextPath, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: nextPath.id });

    worker.resolve({ id: first, value: { x: 1 }, durationMs: 2 });

    expect(preview.getSnapshot()).toMatchObject({ status: "pending", path: firstPath, value: { x: 1 } });
  });

  it("replaces a failed worker before processing the queued preview", () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({ workerFactory: () => workers[workerIndex++] });
    const first = preview.request({ path: { id: "path", x: 1 }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });
    const second = preview.request({ path: { id: "path", x: 2 }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    workers[0].fail();

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].jobs).toEqual([expect.objectContaining({ id: second })]);
    expect(workers[1].jobs).not.toContainEqual(expect.objectContaining({ id: first }));
  });

  it("falls back to direct derivation when a retried worker job also fails", async () => {
    const workers = [new FakeWorker(), new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({
      workerFactory: () => workers[workerIndex++],
      derive: () => ({ recovered: true }),
    });
    const revision = preview.request({ path: { id: "path" }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    workers[0].fail();
    workers[1].fail();
    await Promise.resolve();

    expect(workerIndex).toBe(2);
    expect(preview.getSnapshot()).toMatchObject({ status: "ready", revision, value: { recovered: true } });

    const nextRevision = preview.request({ path: { id: "path", x: 2 }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });
    expect(workerIndex).toBe(3);
    workers[2].resolve({ id: nextRevision, value: { recovered: "worker" }, durationMs: 1 });
    expect(preview.getSnapshot()).toMatchObject({ status: "ready", revision: nextRevision, value: { recovered: "worker" } });
  });

  it("does not rerun known-heavy timed-out work on the UI thread", async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    let directCalls = 0;
    const module = previewModule();
    const preview = module.create({
      workerFactory: () => workers[workerIndex++],
      derive: () => { directCalls += 1; return { unsafe: true }; },
      timeoutMs: 20,
    });
    const path = {
      waypoints: Array.from({ length: 1600 }, () => ({})),
      ranges: Array.from({ length: 1600 }, () => ({})),
    };
    const revision = preview.request({ path, robot: {}, plannerId: "profiledSpline", quality: "interactive" });

    await vi.advanceTimersByTimeAsync(40);
    await Promise.resolve();

    expect(module.directPreviewIsSafe(path, 14)).toBe(false);
    expect(directCalls).toBe(0);
    expect(preview.getSnapshot()).toMatchObject({ status: "error", revision });
  });

  it("rejects transition-heavy direct derivation without ranges", () => {
    const waypointCount = 1600;
    const path = {
      headingMode: "targets",
      ranges: [],
      waypoints: Array.from({ length: waypointCount }, (_, index) => {
        const x = 1 + (index % 100) * 0.01;
        const y = 1 + Math.floor(index / 100) * 0.01;
        return {
          x, y, theta: 0, thetaOn: index === 0 || index === waypointCount - 1,
          stop: false, linked: true, segType: "line",
          prevC: { x: x - 0.001, y }, nextC: { x: x + 0.001, y },
          segmentHeadingMode: index % 2 === 0 ? "manual" : "tangent",
        };
      }),
    };
    const module = previewModule();

    expect(module.directPreviewIsSafe(path, 14)).toBe(false);
    expect(module.directPreviewIsSafe(path, 56)).toBe(false);
  });

  it("rejects maximum-size target-anchor derivation without ranges or transitions", () => {
    const itemCount = 4096;
    const path = {
      id: "target-heavy",
      name: "Target Heavy",
      headingMode: "targets",
      startVel: 0,
      goalVel: 0,
      markers: [],
      ranges: [],
      waypoints: Array.from({ length: itemCount }, (_, index) => {
        const x = 1 + index * 0.001;
        return {
          x, y: 1, theta: 0, thetaOn: index === 0 || index === itemCount - 1,
          stop: false, linked: true, segType: "line",
          prevC: { x: x - 0.0003, y: 1 }, nextC: { x: x + 0.0003, y: 1 },
        };
      }),
      targets: Array.from({ length: itemCount }, (_, index) => ({
        f: index / (itemCount - 1), deg: index % 360, anchor: "param",
      })),
    };
    const module = previewModule();

    expect(module.directPreviewIsSafe(path, 14)).toBe(false);
    expect(module.directPreviewIsSafe(path, 56)).toBe(false);
  });

  it("recovers when posting to the worker throws", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    workers[0].postError = new DOMException("could not clone", "DataCloneError");
    let workerIndex = 0;
    const preview = previewModule().create({ workerFactory: () => workers[workerIndex++] });

    const revision = preview.request({ path: { id: "path" }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].jobs).toEqual([expect.objectContaining({ id: revision })]);
    workers[1].resolve({ id: revision, value: { recovered: true }, durationMs: 1 });
    expect(preview.getSnapshot()).toMatchObject({ status: "ready", revision, value: { recovered: true } });
  });

  it.each(["messageerror", "invalid response"])("recovers from a worker %s", (failure) => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({ workerFactory: () => workers[workerIndex++] });
    const revision = preview.request({ path: { id: "path" }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    if (failure === "messageerror") workers[0].failMessage();
    else workers[0].resolve({ id: revision + 1, value: { wrong: true } });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].jobs).toEqual([expect.objectContaining({ id: revision })]);
  });

  it("recovers when a worker stops responding", async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({
      workerFactory: () => workers[workerIndex++],
      derive: () => ({ recovered: true }),
      timeoutMs: 20,
    });
    const revision = preview.request({ path: { id: "path" }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    await vi.advanceTimersByTimeAsync(20);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].jobs).toEqual([expect.objectContaining({ id: revision })]);
    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    expect(preview.getSnapshot()).toMatchObject({ status: "ready", revision, value: { recovered: true } });
  });

  it("keeps a newer worker request while an older direct fallback is scheduled", async () => {
    const workers = [new FakeWorker(), new FakeWorker(), new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({
      workerFactory: () => workers[workerIndex++],
      derive: (job) => ({ recovered: (job as { path: { x: number } }).path.x }),
    });
    preview.request({ path: { id: "path", x: 1 }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });
    workers[0].fail();
    workers[1].fail();

    const latest = preview.request({ path: { id: "path", x: 2 }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });
    workers[2].fail();
    await Promise.resolve();

    expect(workers[3].jobs).toEqual([expect.objectContaining({ id: latest })]);
    workers[3].resolve({ id: latest, value: { recovered: "latest" }, durationMs: 1 });
    expect(preview.getSnapshot()).toMatchObject({ status: "ready", revision: latest, value: { recovered: "latest" } });
  });

  it("rejects a worker response without a value or error", () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let workerIndex = 0;
    const preview = previewModule().create({ workerFactory: () => workers[workerIndex++] });
    const revision = preview.request({ path: { id: "path" }, robot: {}, plannerId: "profiledSpline", quality: "interactive", key: "path" });

    workers[0].resolve({ id: revision });

    expect(workers[0].terminated).toBe(true);
    expect(workers[1].jobs).toEqual([expect.objectContaining({ id: revision })]);
  });

  it("survives a StrictMode cleanup followed immediately by remount", async () => {
    const worker = new FakeWorker();
    const preview = previewModule().create({ workerFactory: () => worker });
    const release = preview.retain();
    preview.request({ path: {}, robot: {}, plannerId: "profiledSpline", quality: "interactive" });
    release();
    const releaseAfterReplay = preview.retain();
    await Promise.resolve();

    expect(worker.terminated).toBe(false);
    releaseAfterReplay();
    await Promise.resolve();
    expect(worker.terminated).toBe(true);
  });
});
