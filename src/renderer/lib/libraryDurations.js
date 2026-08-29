/** One background worker at a time; the active editor supplies its own selected result. */
export function createLibraryDurations(planner) {
  let entries = new Map();
  let snapshot = {};
  let activeId = null;
  let running = null;
  const listeners = new Set();
  const publish = () => {
    snapshot = Object.fromEntries([...entries].map(([id, entry]) => [id, entry.result]));
    listeners.forEach((listener) => listener());
  };
  const stop = () => {
    const previous = running;
    running = null;
    previous?.request.cancel();
  };
  const advance = () => {
    if (running) return;
    const entry = [...entries.values()].find((item) => item.id !== activeId && item.result.status === 'pending');
    if (!entry) return;
    const request = planner.request({ key: entry.id, path: entry.path, robot: entry.robot, plannerId: entry.plannerId }, { deadline: 'common' });
    const job = { entry, request };
    running = job;
    request.promise.then((result) => {
      if (running !== job || entries.get(entry.id) !== entry) return;
      running = null;
      const seconds = result.value?.prof?.totalTime;
      const invalid = entry.path.optimization?.accepted && !entry.outdatedOptimization && !result.value?.acceptedTrajectory;
      entry.result = result.status === 'success' && result.value?.finalTrajectory && !invalid && Number.isFinite(seconds)
        ? { status: 'ready', seconds }
        : { status: 'error', message: invalid ? 'The selected optimization could not be validated. Review this path.' : result.fallbackReason || 'Could not prepare this trajectory.' };
      publish();
      advance();
    });
  };
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    update(inputs, selected) {
      entries = new Map(inputs.map((input) => {
        const previous = entries.get(input.id);
        return [input.id, previous?.key === input.key ? previous : { ...input, result: { status: 'pending' } }];
      }));
      activeId = selected.id;
      if (running && (entries.get(running.entry.id) !== running.entry || running.entry.id === activeId)) stop();
      const active = entries.get(activeId);
      if (active && selected.status !== 'pending') active.result = selected;
      publish();
      advance();
    },
    cancel() { stop(); },
  };
}
