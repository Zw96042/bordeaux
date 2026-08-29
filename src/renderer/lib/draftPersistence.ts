export const PROJECT_DRAFT_SELECTOR = "[data-project-draft]";

type DraftElement = Element & { blur: () => void; focus: () => void };
type PersistenceSnapshot = { project: unknown; editRevision: number; draftGeneration: number };
type PersistenceEnqueue = <T>(operation: () => T | Promise<T>) => Promise<T>;

export function enqueuePersistenceAfterPreflight<T>(
  enqueue: PersistenceEnqueue,
  preflight: () => boolean,
  operation: () => T | Promise<T>,
): Promise<T | undefined> {
  return enqueue(async () => preflight() ? operation() : undefined);
}

export function projectPersistenceStayedCurrent(before: PersistenceSnapshot, after: PersistenceSnapshot): boolean {
  return before.project === after.project
    && before.editRevision === after.editRevision
    && before.draftGeneration === after.draftGeneration;
}

export function noteProjectDraftInput(
  target: EventTarget | null,
  dirty: boolean,
  markDirty: () => void,
  scheduleAutosave: () => void,
): boolean {
  if (!(target instanceof Element) || !target.matches(PROJECT_DRAFT_SELECTOR)) return false;
  if (!dirty) markDirty();
  scheduleAutosave();
  return true;
}

export function flushFocusedProjectDraft(
  source: Pick<Document, "activeElement" | "querySelector"> = document,
  flush: (callback: () => void) => void = (callback) => callback(),
): boolean {
  const active = source.activeElement as DraftElement | null;
  if (active?.matches(PROJECT_DRAFT_SELECTOR) && typeof active.blur === "function") flush(() => active.blur());
  const invalid = source.querySelector(`${PROJECT_DRAFT_SELECTOR}[aria-invalid="true"]`) as DraftElement | null;
  if (!invalid) return true;
  invalid.focus();
  return false;
}
