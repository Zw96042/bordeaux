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
