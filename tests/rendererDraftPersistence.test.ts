import { describe, expect, it, vi } from "vitest";
import {
  enqueuePersistenceAfterPreflight,
  flushFocusedProjectDraft,
  noteProjectDraftInput,
  projectPersistenceStayedCurrent,
} from "../src/renderer/lib/draftPersistence";

function draft(_valid: boolean) {
  const element = {
    matches: () => true,
    blur: vi.fn(),
    focus: vi.fn(),
  };
  return element;
}

function persistenceQueue() {
  let tail = Promise.resolve();
  return <T>(operation: () => T | Promise<T>): Promise<T> => {
    const pending = tail.catch(() => undefined).then(operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
}

describe("renderer draft persistence", () => {
  it("marks an uncommitted draft dirty immediately so close is guarded", () => {
    const markDirty = vi.fn();
    const scheduleAutosave = vi.fn();
    const input = { matches: () => true };
    vi.stubGlobal("Element", class { static [Symbol.hasInstance](value: unknown) { return value === input; } });

    expect(noteProjectDraftInput(input as any, false, markDirty, scheduleAutosave)).toBe(true);
    expect(markDirty).toHaveBeenCalledOnce();
    expect(scheduleAutosave).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("flushes a valid focused draft before persistence continues", () => {
    const element = draft(true);
    const flush = vi.fn((callback: () => void) => callback());
    expect(flushFocusedProjectDraft({ activeElement: element as any, querySelector: () => null }, flush)).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
    expect(element.blur).toHaveBeenCalledOnce();
  });

  it("rejects and refocuses an invalid draft", () => {
    const element = draft(false);
    expect(flushFocusedProjectDraft({ activeElement: element as any, querySelector: () => element as any })).toBe(false);
    expect(element.blur).toHaveBeenCalledOnce();
    expect(element.focus).toHaveBeenCalledOnce();
  });

  it("does not clear dirty when a newer draft begins during a save", async () => {
    const project = {};
    const before = { project, editRevision: 4, draftGeneration: 7 };
    let current = before;
    let finishSave!: () => void;
    const delayedSave = new Promise<void>((resolve) => { finishSave = resolve; });
    const clearDirty = vi.fn();
    const completion = delayedSave.then(() => {
      if (projectPersistenceStayedCurrent(before, current)) clearDirty();
    });

    current = { ...before, draftGeneration: 8 };
    finishSave();
    await completion;

    expect(clearDirty).not.toHaveBeenCalled();
  });

  it("flushes a draft begun after Save was queued before running the save", async () => {
    const enqueue = persistenceQueue();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    void enqueue(() => blocker);
    let draftStarted = false;
    const flush = vi.fn(() => draftStarted);
    const save = vi.fn();

    const pending = enqueuePersistenceAfterPreflight(enqueue, flush, save);
    draftStarted = true;
    release();
    await pending;

    expect(flush).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });

  it.each(["New", "Open"])("rechecks %s replacement safety after earlier persistence finishes", async () => {
    const enqueue = persistenceQueue();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    void enqueue(() => blocker);
    let dirty = false;
    const confirmDiscard = vi.fn(() => false);
    const canReplace = vi.fn(() => !dirty || confirmDiscard());
    const replace = vi.fn();

    const pending = enqueuePersistenceAfterPreflight(enqueue, canReplace, replace);
    dirty = true;
    release();
    await pending;

    expect(canReplace).toHaveBeenCalledOnce();
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });
});
