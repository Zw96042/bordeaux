import { AUTO } from "./routineModel";

/** How many path steps in this routine follow each path, by path id. */
export function routinePathUses(routine) {
  const uses = new Map();
  AUTO.walk(routine?.nodes || [], (node) => { if (node.type === 'path' && node.ref) uses.set(node.ref, (uses.get(node.ref) || 0) + 1); });
  return uses;
}

/**
 * Path choices for routine steps: the name first, then its folder, its trajectory time as the library shows it, and
 * whether this routine already follows it. The folder is searchable so a team's grouping finds its paths.
 */
export function routinePathChoices(paths, { folders = [], times = {}, uses = new Map() } = {}) {
  return paths.map((path) => {
    const folder = path.folderId ? folders.find((item) => item.id === path.folderId)?.name || '' : '';
    const time = times[path.id], count = uses.get(path.id) || 0;
    const duration = (path.waypoints?.length || 0) < 2 ? 'Not timed yet' : time?.status === 'ready' ? time.seconds.toFixed(2) + ' s' : '';
    const used = count === 1 ? 'In this routine' : count > 1 ? 'Used ' + count + '× in this routine' : '';
    return { path, folder, meta: [folder, duration, used].filter(Boolean).join(' · ') };
  });
}
