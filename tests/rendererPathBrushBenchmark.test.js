benchmark("smooths a valid maximum-size ranged path", () => {
  const { waypointCount, rangeCount, runs } = settings();
  const fixture = densePath(waypointCount, rangeCount);
  const samples = [];
  let removed = 0;
  for (let run = 0; run < runs + 1; run += 1) {
    const path = structuredClone(fixture);
    const started = performance.now();
    removed = PathBrush.apply(path, {
      kind: "smooth", previous: { x: 8.45, y: 4 }, center: { x: 8.5, y: 4 },
      radius: 3, strength: 1,
    }).removed;
    if (run > 0) samples.push(performance.now() - started);
  }
  expect(removed).toBeGreaterThan(0);
  expect(removed).toBeLessThanOrEqual(16);
  summarize("path-brush-smooth", waypointCount, rangeCount, removed, samples);
});

benchmark("measures a cold smooth-draft pointer sample", () => {
  const { waypointCount, rangeCount, runs } = settings();
  const fixture = densePath(waypointCount, rangeCount);
  const stroke = {
    kind: "smooth", previous: { x: 8.45, y: 4 }, center: { x: 8.5, y: 4 },
    radius: 3, strength: 1,
  };
  const samples = [];
  let removed = 0;
  for (let run = 0; run < runs + 1; run += 1) {
    let draft = null;
    const store = {
      getSnapshot: () => draft,
      begin: (value) => { draft = value; },
      update: (value) => { draft = value; },
    };
    const started = performance.now();
    removed = applyBrushDraft(store, fixture, stroke).removed;
    if (run > 0) samples.push(performance.now() - started);
  }
  expect(removed).toBeGreaterThan(0);
  summarize("path-brush-cold-pointer-sample", waypointCount, rangeCount, removed, samples);
});
