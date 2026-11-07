import { focusIfAvailable } from './focusReturn';

// Placing a command opens its search once. The request names one placement in one document and path, and is
// spent by the render that first shows that marker selected, whether its chooser opened or not.

/** A request only when the robot catalog can offer commands at placement; otherwise nothing is left pending. */
export const commandPickRequest = (token, { catalog, status, documentKey, pathId, markerId }) =>
  catalog?.commands?.length && status !== 'loading' ? { token, documentKey, pathId, markerId } : null;

/** Whether a request is spent: shown, stale, its marker gone, or its placement's selection no longer pending. */
export function retireCommandPick(pick, { projectKey, docId, markers = [], sel, selPending }) {
  if (!pick) return false;
  const at = markers.findIndex((marker) => marker?.id === pick.markerId);
  return pick.documentKey !== projectKey || pick.pathId !== docId || at < 0 || (sel?.kind === 'em' && sel.idx === at) || !selPending;
}

/** Compare-and-clear: a retirement clears only its own request, never a newer placement's. */
export const clearCommandPick = (token) => (current) => (current?.token === token ? null : current);

// Catalog arrays are immutable IPC snapshots. Replacing a catalog invalidates these weak identity caches.
const choiceCache = new WeakMap(), richChoiceCache = new WeakMap();
const emptyCommands = [];
/** "No command" appears only once one is set, last, so typing never makes it the first match. */
export function commandChoices(commands = emptyCommands, invocationId = '') {
  let cached = choiceCache.get(commands);
  if (!cached) {
    const items = commands.map(command => ({ value: command.id, label: command.label, meta: command.member, searchText: [command.description, command.id].filter(Boolean).join(' ') }));
    cached = { ids: new Set(commands.map(command => command.id)), items, selectedItems: items.concat({ value: '', label: 'No command' }) };
    choiceCache.set(commands, cached);
  }
  if (invocationId && !cached.ids.has(invocationId)) {
    if (cached.missingId !== invocationId) {
      cached.missingId = invocationId;
      cached.missingItems = [{ value: invocationId, label: invocationId, meta: 'Not in robot code', badge: 'Missing' }, ...cached.selectedItems];
    }
    return cached.missingItems;
  }
  return invocationId ? cached.selectedItems : cached.items;
}

/** Rich marker-inspector discovery keeps parameter and semantic searches, independently of selection. */
export function inspectorCommandChoices(commands, invocationId = '', actionTag = '') {
  let cached = richChoiceCache.get(commands);
  if (!cached) {
    const items = commands.map(command => ({ value: command.id, label: command.label,
      meta: (command.parameters || []).filter(parameter => parameter.role === 'argument').map(parameter => parameter.label || parameter.name).join(', ') || command.member,
      badge: '', searchText: [command.description, command.id, command.ownerType, command.member].concat(command.semanticTags || [])
        .concat((command.parameters || []).map(parameter => [parameter.name, parameter.label, parameter.description, parameter.unit, parameter.valueType].filter(Boolean).join(' ')))
        .filter(Boolean).join(' '),
    }));
    cached = { ids: new Set(commands.map(command => command.id)), items: [{ value: '', label: 'No command' }, ...items], actionTag: '', actionItems: null };
    richChoiceCache.set(commands, cached);
  }
  let items = cached.items;
  if (actionTag) {
    if (cached.actionTag !== actionTag || !cached.actionItems) {
      cached.actionTag = actionTag;
      cached.actionItems = [cached.items[0], ...commands.map((command, index) => ({ ...cached.items[index + 1], badge: (command.semanticTags || []).includes(actionTag) ? 'Matches action' : '' }))];
    }
    items = cached.actionItems;
  }
  if (invocationId && !cached.ids.has(invocationId)) {
    if (cached.missingId !== invocationId || cached.missingBase !== items) {
      cached.missingId = invocationId; cached.missingBase = items;
      cached.missingItems = [items[0], { value: invocationId, label: String(invocationId).split('.').pop() || String(invocationId), meta: 'Saved command is unavailable', badge: 'Missing' }, ...items.slice(1)];
    }
    return cached.missingItems;
  }
  return items;
}

/**
 * Escape from the closed command trigger clears the selection like Escape on the field; the open search keeps its
 * own first Escape. Focus moves to the first available target only after the clear succeeds.
 */
export function escapeCommandTrigger(event, escapeSelection, targets) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || event.target !== event.currentTarget.querySelector('.cmd-picker-trigger') || !escapeSelection?.()) return false;
  event.preventDefault();
  targets().some(focusIfAvailable);
  return true;
}
