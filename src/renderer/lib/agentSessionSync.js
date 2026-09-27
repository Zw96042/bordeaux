const FIELD_PACK = Object.freeze({ id: '2026-rebuilt', revision: '2026-manual-tu19-welded-4' });

/**
 * Agents see editor snapshots only while MCP access is on. Every access
 * period (generation) starts empty in the main process, so enabling publishes
 * immediately and disabling forgets the published context.
 *
 * `capture()` returns { project, materialized, activePathId, editRevision }:
 * `project` is the editor state compared for staleness, `materialized` the
 * data sent over IPC, which structured-clones it.
 */
export function createAgentSessionSync({ send, sessionId, capture, onPublish, onAccessChange, events, delayMs = 150 }) {
  let access = { enabled: false, generation: -1 };
  let revision = -1;
  let published = null;
  const publish = () => {
    if (!access.enabled) return;
    const context = capture();
    revision += 1;
    published = { revision, project: context.project, activePathId: context.activePathId, editRevision: context.editRevision };
    send({
      sessionId,
      revision,
      accessGeneration: access.generation,
      project: context.materialized,
      activePathId: context.activePathId,
      allianceView: 'blue',
      fieldPack: FIELD_PACK,
    });
    onPublish(revision);
  };
  return {
    revision: () => revision,
    published: () => published,
    enabled: () => access.enabled,
    /** Status replies and events can arrive out of order; older generations are ignored. */
    setAccess(status) {
      const generation = Number.isSafeInteger(status?.generation) ? status.generation : 0;
      const enabled = status?.enabled === true;
      if (generation < access.generation || (generation === access.generation && enabled === access.enabled)) return;
      access = { enabled, generation };
      published = null;
      onAccessChange(enabled);
      publish();
    },
    /** Publishes after a quiet period or the next pointer release; returns a cancel function. */
    schedule() {
      if (!access.enabled) return () => {};
      let pending = true;
      const run = () => { if (pending) { pending = false; publish(); } };
      const timer = setTimeout(run, delayMs);
      events.addEventListener('pointerup', run, { once: true });
      return () => { pending = false; clearTimeout(timer); events.removeEventListener('pointerup', run); };
    },
  };
}
