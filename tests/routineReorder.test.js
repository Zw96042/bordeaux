    expect(AUTO.siblingNodes(result, id).map((node) => node.id)).toEqual(expected);
    expect(original).toEqual(snapshot);
  });

  it.each([
    ['first', 'yes-1', true], ['yes-1', 'first', false],
    ['yes-1', 'no-1', true], ['yes-1', 'decision', true],
    ['decision', 'yes-1', true], ['yes-1', 'yes-1', false],
    ['yes-1', 'yes-2', true], ['yes-2', 'yes-1', false],
    ['missing', 'first', true], ['first', 'missing', true],
  ])('does not advertise or mutate an invalid/no-op move from %s to %s', (id, target, before) => {
    const routine = fixture();
    expect(AUTO.canReorderRelative(routine, id, target, before)).toBe(false);
    expect(AUTO.reorderRelative(routine, id, target, before)).toBe(routine);
  });
});
