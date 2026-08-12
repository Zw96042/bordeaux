import { PM } from "../lib/pathMath";

  const SAMPLES_BY_QUALITY = Object.freeze({ interactive: 14, final: 56 });
  const MAX_DIRECT_POLICY_SAMPLE_WORK = 2000;

  function samplesForQuality(quality) {
    return SAMPLES_BY_QUALITY[quality] || SAMPLES_BY_QUALITY.final;
  }

  function headingTransitionCount(path) {
    const waypoints = Array.isArray(path?.waypoints) ? path.waypoints : [];
    const defaultMode = path?.headingMode || 'targets';
    let previousLaw = null;
    let transitions = 0;
    for (let segment = 0; segment < waypoints.length - 1; segment++) {
      const waypoint = waypoints[segment] || {};
      const mode = waypoint.segmentHeadingMode || defaultMode;
      const target = waypoint.segmentLookAt;
      const law = mode === 'lookAt' ? `lookAt:${target ? target.x : ''}:${target ? target.y : ''}` : mode;
      if (previousLaw !== null && law !== previousLaw) transitions++;
      previousLaw = law;
    }
    return transitions;
  }

  function headingAnchorCount(path) {
    const waypoints = Array.isArray(path?.waypoints) ? path.waypoints : [];
    const targets = Array.isArray(path?.targets) ? path.targets : [];
    const waypointAnchors = waypoints.reduce((count, waypoint, index) => (
      count + ((index === 0 || index === waypoints.length - 1 || waypoint?.thetaOn) ? 1 : 0)
    ), 0);
    return targets.length + waypointAnchors;
  }

  function directPreviewWork(path, perSegment) {
    const translationPriority = (path?.ranges || []).some((range) => range?.rotationPriority === 'translation')
      || (path?.waypoints || []).some((waypoint) => waypoint?.headingTransition?.rotationPriority === 'translation');
    // Translation-priority tracking can require up to 250,000 terminal catch-up
    // iterations independently of geometry size, so it is never a tiny fallback.
    if (translationPriority) return Infinity;
    const segments = Math.max(0, (path?.waypoints?.length || 0) - 1);
    const policyScans = Math.max(1, (path?.ranges?.length || 0) + headingTransitionCount(path) + headingAnchorCount(path));
    return segments * perSegment * policyScans;
  }
  const directWorkIsSafe = (work) => work <= MAX_DIRECT_POLICY_SAMPLE_WORK;
  const directPreviewIsSafe = (path, perSegment) => directWorkIsSafe(directPreviewWork(path, perSegment));

  function browserBenchmarkTransport() {
    if (typeof location === 'undefined' || typeof URLSearchParams === 'undefined'
      || typeof CustomEvent === 'undefined' || typeof dispatchEvent !== 'function'
      || typeof addEventListener !== 'function') return null;
    if (!location.search) return null;
    const params = new URLSearchParams(location.search);
    const mode = params.get('bordeauxBenchmarkTransport');
    if (mode !== 'observe' && mode !== 'force-direct') return null;
    const waypointIndex = Number.parseInt(params.get('bordeauxBenchmarkWaypoint'), 10);
    if (!Number.isInteger(waypointIndex) || waypointIndex < 0) return null;
    let observerMode = 'stopped';
    let windowId = null;
    let schedulerId = 0;
    let workerRequests = new Set();
    let workerResults = new Set();
    let directResults = 0;
    addEventListener('bordeaux-benchmark:path-preview-transport-control', (event) => {
      const control = typeof event.detail === 'string' ? { mode: event.detail } : event.detail;
      if (control?.mode === 'proof' || control?.mode === 'stop') {
        observerMode = control.mode === 'proof' ? 'proof' : 'stopped';
        return;
      }
      if (control?.mode === 'timed-start') {
        observerMode = 'timed';
        windowId = control.windowId;
        workerRequests = new Set();
        workerResults = new Set();
        directResults = 0;
        return;
      }
      if (control?.mode !== 'timed-report' || observerMode !== 'timed' || control.windowId !== windowId) return;
      observerMode = 'stopped';
      dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport', {
        detail: {
          phase: 'summary',
          windowId,
          schedulerId,
          interactiveWorkerRequests: workerRequests.size,
          matchingWorkerResults: workerResults.size,
          directResults,
        },
      }));
    });
    return {
      forceDirect: mode === 'force-direct',
      observe(event) {
        schedulerId = event.schedulerId;
        if (observerMode === 'timed') {
          if (event.job.quality !== 'interactive') return;
          if (event.phase === 'request' && event.source === 'worker') workerRequests.add(event.job.revision);
          else if (event.phase === 'result' && event.source === 'worker' && workerRequests.has(event.job.revision)) workerResults.add(event.job.revision);
          else if (event.phase === 'result' && event.source === 'direct') directResults += 1;
          return;
        }
        if (observerMode !== 'proof') return;
        const waypoint = event.job.path?.waypoints?.[waypointIndex];
        dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport', {
          detail: {
            phase: event.phase,
            source: event.source,
            schedulerId: event.schedulerId,
            revision: event.job.revision,
            quality: event.job.quality,
            key: event.job.key ?? null,
            waypoint: waypoint ? { x: waypoint.x, y: waypoint.y } : null,
          },
        }));
      },
    };
  }

  let schedulerSequence = 0;

  /**
   * Owns path-preview scheduling. At most one worker job and one replacement job
   * are retained, so pointer motion cannot build an obsolete rendering backlog.
   */
  function create(options) {
    const config = options || {};
    const listeners = new Set();
    const derive = config.derive || ((job) => PM.derivePath(job.path, job.robot, job.perSegment, job.plannerId));
    const directIsSafe = config.directIsSafe || ((job) => directPreviewIsSafe(job.path, job.perSegment));
    const workerPayload = config.workerPayload || ((job) => ({
      id: job.revision,
      path: job.path,
      robot: job.robot,
      plannerId: job.plannerId,
      perSegment: job.perSegment,
      quality: job.quality,
    }));
    const benchmarkTransport = config.transportObserver
      ? { forceDirect: Boolean(config.forceDirect), observe: config.transportObserver }
      : browserBenchmarkTransport();
    const schedulerId = benchmarkTransport ? ++schedulerSequence : 0;
    const workerFactory = config.workerFactory || (() => {
      if (benchmarkTransport?.forceDirect) throw new Error('Benchmark forced direct path-preview derivation.');
      return new Worker(new URL('./path-preview-worker.js', import.meta.url), { type: 'module' });
    });
    const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(1, config.timeoutMs) : 5000;
    let worker = null;
    let inFlight = null;
    let inFlightTimer = 0;
    let queued = null;
    let directJob = null;
    let directScheduled = false;
    let latestRevision = 0;
    let publishedRevision = 0;
    let destroyed = false;
    let retainCount = 0;
    let retireRevision = 0;
    let snapshot = {
      status: 'idle',
      revision: 0,
      quality: 'final',
      key: null,
      path: null,
      value: null,
      error: null,
      errorKey: null,
      errorPath: null,
      durationMs: 0,
    };

    const notify = () => {
      listeners.forEach((listener) => listener());
    };

    const observeTransport = (phase, source, job) => {
      if (!benchmarkTransport?.observe) return;
      try { benchmarkTransport.observe({ phase, source, schedulerId, job }); }
      catch (_error) { /* Benchmark observation must never affect preview fallback. */ }
    };

    const publish = (job, result, source) => {
      if (destroyed || job.revision < publishedRevision) return;
      const current = job.revision === latestRevision;
      if (result.error && !current) return;
      if (!result.error) {
        publishedRevision = job.revision;
        observeTransport('result', source, job);
      }
      snapshot = result.error
        ? { ...snapshot, status: 'error', revision: latestRevision, sourceRevision: job.revision, quality: job.quality, error: result.error, errorKey: job.key, errorPath: job.path }
        : {
            status: current ? 'ready' : 'pending',
            revision: latestRevision,
            sourceRevision: job.revision,
            quality: job.quality,
            key: job.key,
            path: job.path,
            value: result.value,
            error: null,
            errorKey: null,
            errorPath: null,
            durationMs: result.durationMs || 0,
          };
      notify();
    };

    const runDirect = () => {
      if (directScheduled || destroyed) return;
      directScheduled = true;
      queueMicrotask(() => {
        directScheduled = false;
        const job = directJob;
        directJob = null;
        if (!job || destroyed) return;
        const startedAt = performance.now();
        try {
          publish(job, { value: derive(job), durationMs: performance.now() - startedAt }, 'direct');
        } catch (error) {
          publish(job, { error: { message: error instanceof Error ? error.message : String(error) } }, 'direct');
        }
        if (directJob) runDirect();
      });
    };

    const runDirectOrFail = (job, reason) => {
      if (job.plannerId === 'optimizedTrajectory') {
        publish(job, { error: { message: `${reason} Optimized previews require the planning worker.` } }, 'direct');
        return;
      }
      if (directIsSafe(job)) {
        directJob = job;
        runDirect();
      } else {
        publish(job, { error: { message: `${reason} This path is too large to derive safely on the UI thread.` } }, 'direct');
      }
    };

    const clearInFlightTimer = () => {
      if (inFlightTimer) clearTimeout(inFlightTimer);
      inFlightTimer = 0;
    };

    const takeInFlight = () => {
      const job = inFlight;
      inFlight = null;
      clearInFlightTimer();
      return job;
    };

    let recoverWorker;
    const send = (job) => {
      const targetWorker = worker;
      if (!targetWorker) {
        runDirectOrFail(job, 'Path preview worker is unavailable.');
        return;
      }
      inFlight = job;
      clearInFlightTimer();
      inFlightTimer = setTimeout(() => recoverWorker(targetWorker, 'Path preview worker timed out.'), timeoutMs);
      try {
        targetWorker.postMessage(workerPayload(job));
        observeTransport('request', 'worker', job);
      } catch (error) {
        recoverWorker(targetWorker, error instanceof Error ? error.message : String(error));
      }
    };

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      queued = null;
      directJob = null;
      takeInFlight();
      listeners.clear();
      if (worker) worker.terminate();
      worker = null;
    };

    const cancel = () => {
      if (destroyed) return;
      latestRevision += 1;
      queued = null;
      directJob = null;
      takeInFlight();
      if (worker) worker.terminate();
      worker = null;
      snapshot = { ...snapshot, status: 'idle', revision: latestRevision, error: null, errorKey: null, errorPath: null };
      notify();
    };

    const attachWorker = (nextWorker) => {
      worker = nextWorker;
      nextWorker.onmessage = (event) => {
        if (worker !== nextWorker || !inFlight) return;
        const result = event.data;
        const hasResult = result && typeof result === 'object'
          && (Object.prototype.hasOwnProperty.call(result, 'value') || Boolean(result.error));
        if (!hasResult || result.id !== inFlight.revision) {
          recoverWorker(nextWorker, 'Path preview worker returned an invalid response.');
          return;
        }
        const completed = takeInFlight();
        publish(completed, result, 'worker');
        if (queued) {
          const next = queued;
          queued = null;
          send(next);
        }
      };
      nextWorker.onerror = (event) => {
        recoverWorker(nextWorker, event.message || 'Path preview worker failed.');
      };
      nextWorker.onmessageerror = () => recoverWorker(nextWorker, 'Path preview worker returned an unreadable response.');
    };

    recoverWorker = (failedWorker, message) => {
      if (worker !== failedWorker || destroyed) return;
      const completed = takeInFlight();
      failedWorker.terminate();
      worker = null;
      if (!queued && completed && completed.retried) {
        runDirectOrFail(completed, message);
        return;
      }
      let next = queued;
      queued = null;
      if (!next && completed) next = { ...completed, retried: true };
      if (!next) return;
      try {
        attachWorker(workerFactory());
        send(next);
      } catch (_error) {
        worker = null;
        runDirectOrFail(next, message);
      }
    };

    const ensureWorker = () => {
      if (worker || destroyed) return Boolean(worker);
      try {
        attachWorker(workerFactory());
      } catch (_error) {
        worker = null;
      }
      return Boolean(worker);
    };

    return {
      request(input) {
        if (destroyed) return latestRevision;
        const quality = input.quality === 'interactive' ? 'interactive' : 'final';
        const job = {
          ...input,
          quality,
          perSegment: samplesForQuality(quality),
          revision: ++latestRevision,
        };
        snapshot = { ...snapshot, status: 'pending', revision: job.revision, quality, error: null, errorKey: null, errorPath: null };
        notify();
        ensureWorker();
        if (!worker) {
          runDirectOrFail(job, 'Path preview worker is unavailable.');
        } else if (inFlight) {
          queued = job;
        } else {
          send(job);
        }
        return job.revision;
      },
      getSnapshot() {
        return snapshot;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      retain() {
        if (destroyed) return () => {};
        retainCount += 1;
        retireRevision += 1;
        let retained = true;
        return () => {
          if (!retained || destroyed) return;
          retained = false;
          retainCount -= 1;
          const revision = ++retireRevision;
          queueMicrotask(() => {
            if (!destroyed && retainCount === 0 && revision === retireRevision) destroy();
          });
        };
      },
      cancel,
      destroy,
    };
  }

export const PathPreview = Object.freeze({ create, samplesForQuality, directPreviewWork, directWorkIsSafe, directPreviewIsSafe });
