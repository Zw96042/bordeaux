  const FINAL_SAMPLES_PER_SEGMENT = 56;
  const DEFAULT_DEADLINES_MS = Object.freeze({ common: 10000, stress: 30000, hard: 60000 });

  /** Runs deliberate final-planning work independently from interactive preview. */
  function create(options) {
    const config = options || {};
    const workerFactory = config.workerFactory || (() => {
      return new Worker(new URL('./path-preview-worker.js', import.meta.url), { type: 'module' });
    });
    const deadlines = Object.fromEntries(Object.entries(DEFAULT_DEADLINES_MS).map(([name, fallback]) => [
      name,
      Number.isFinite(config.deadlines?.[name]) ? Math.max(1, config.deadlines[name]) : fallback,
    ]));
    let sequence = 0;

    return {
      request(input, requestOptions) {
        const requestConfig = requestOptions || {};
        const id = ++sequence;
        const deadline = Object.prototype.hasOwnProperty.call(deadlines, requestConfig.deadline)
          ? requestConfig.deadline
          : 'common';
        const deadlineMs = deadlines[deadline];
        let settled = false;
        let timer = 0;
        let worker = null;
        let resolveResult;
        const promise = new Promise((resolve) => { resolveResult = resolve; });
        const finish = (result) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (worker) worker.terminate();
          resolveResult(result);
        };
        const fail = (message) => finish({
          status: 'failure',
          error: { message },
          fallback: requestConfig.interactiveResult,
          fallbackReason: `Final planning failed: ${message}. Continuing with the last interactive result.`,
        });
        try {
          worker = workerFactory();
          worker.onmessage = (event) => {
            const result = event.data;
            if (!result || result.id !== id) {
              fail('The final-planning worker returned an invalid response');
              return;
            }
            if (result.error) {
              fail(result.error.message || 'The final-planning worker failed');
              return;
            }
            if (!Object.prototype.hasOwnProperty.call(result, 'value')) {
              fail('The final-planning worker returned an invalid response');
              return;
            }
            finish({ status: 'success', value: result.value, durationMs: result.durationMs || 0 });
          };
          worker.onerror = (event) => fail(event.message || 'The final-planning worker failed');
          worker.onmessageerror = () => fail('The final-planning worker returned an unreadable response');
          timer = setTimeout(() => finish({
            status: 'timeout',
            deadline,
            deadlineMs,
            fallback: requestConfig.interactiveResult,
            fallbackReason: `Final planning exceeded the ${deadline} deadline (${deadlineMs} ms); continuing with the last interactive result.`,
          }), deadlineMs);
          worker.postMessage({
            id,
            ...input,
            quality: 'final',
            perSegment: FINAL_SAMPLES_PER_SEGMENT,
          });
        } catch (error) {
          fail(error && typeof error.message === 'string' ? error.message : String(error));
        }
        return {
          promise,
          cancel() {
            finish({
              status: 'canceled',
              fallback: requestConfig.interactiveResult,
              fallbackReason: 'Final planning was canceled; continuing with the last interactive result.',
            });
          },
        };
      },
    };
  }

export const FinalPlanning = Object.freeze({ create });
