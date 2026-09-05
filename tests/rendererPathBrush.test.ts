    // replace its 2 m handles outright and swing the curve by most of a metre.
    { label: "barely reaching the waypoint", center: { x: 4.5, y: 4 }, radius: 1.2 },
  ])("confines a 1 cm drag on a long-handled path $label", ({ center, radius }) => {
    const path = longHandlePath();
    const before = samplePath(path);

    brush().apply(path, { kind: "push", previous: { x: center.x, y: center.y - 0.01 }, center, radius, strength: 1 });

    // Originally a 1 cm drag here moved the curve 0.9 m several metres away.
    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.0006);
  });

  it("declines a smooth merge that would move the wave outside the brush", () => {
    // A dense sine, the shape Smooth is normally used on. The waypoint under the brush is
    // mergeable on its own terms, but collapsing it rewrites both neighbours' handles and
    // drags the next crest, which lies outside the radius.
    const steps = 10;
    const path: Path = {
      waypoints: Array.from({ length: steps + 1 }, (_, index) => {
        const x = 1 + index * (10 / steps);
        const y = 4 + Math.sin((index / steps) * Math.PI * 2) * 0.3;
        return { x, y, prevC: { x: x - 0.35, y }, nextC: { x: x + 0.35, y }, linked: true, theta: 0, thetaOn: index === 0 || index === steps, stop: false, segType: "bezier" };
      }),
      ranges: [],
    };
    const center = { x: 5.5, y: 4 };
    const radius = 1.2;
    const before = samplePath(path);

    brush().apply(path, { kind: "smooth", previous: { x: 5.45, y: 4 }, center, radius, strength: 1 });

    // Taking the merge here roughly doubles how far the outside curve shifts.
    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.008);
  });

  // Repeated strokes are the real usage pattern, and each one re-subdivides. Without a
  // waypoint pinned just past the rim, every stroke bends the segment leaving the brush and
  // the error compounds.
  it("keeps repeated strokes from accumulating drift outside the brush", () => {
    const path = curvedPath();
    const pathBrush = brush();
    const center = { x: 6.5, y: 4.6 };
    const radius = 0.9;
    const before = samplePath(path);

    for (let step = 0; step < 12; step++) {
      pathBrush.apply(path, { kind: "push", previous: { x: center.x, y: center.y - 0.01 }, center, radius, strength: 1 });
    }

    expect(driftOutside(before, samplePath(path), center, radius)).toBeLessThan(0.002);
  });

  it("holds a curved-segment range anchor in place through subdivision", () => {
    const path = curvedPath();
    path.ranges = [{ anchor: "wp", w0: 0, t0: 0.4, w1: 2, t1: 0.6 }];
    const startBefore = anchorPoint(path, 0, 0.4);
    const endBefore = anchorPoint(path, 2, 0.6);

    brush().apply(path, { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5, y: 4.05 }, radius: 1.5, strength: 0.4 });

    const range = path.ranges[0];
    expect(gap(anchorPoint(path, range.w0, range.t0), startBefore)).toBeLessThan(0.0001);
    expect(gap(anchorPoint(path, range.w1, range.t1), endBefore)).toBeLessThan(0.0001);
  });

  // App.applyBrush follows a `wp` selection by object identity across a stroke. These cover
  // the contract that makes that possible: a surviving waypoint stays the same object, and
  // a merged one is gone rather than replaced in place.
  it("keeps surviving waypoints identical across a stroke that inserts topology", () => {
    const path = curvedPath();
    const tracked = path.waypoints[2];

    const result = brush().apply(path, { kind: "push", previous: { x: 3.2, y: 2.6 }, center: { x: 3.2, y: 3 }, radius: 1.5, strength: 1 });

    expect(result.added).toBeGreaterThan(0);
    const moved = path.waypoints.indexOf(tracked);
    // Still the same object, at a higher index now that waypoints were inserted before it.
    expect(moved).toBeGreaterThan(2);
    expect(path.waypoints[moved]).toBe(tracked);
  });

  it("drops a merged waypoint from the path rather than replacing it in place", () => {
    const path = legacyRangePath(2);
    path.ranges = [];
    const tracked = path.waypoints[2];

    const result = brush().apply(path, { kind: "smooth", previous: { x: 5.4, y: 4 }, center: { x: 5.5, y: 4 }, radius: 1, strength: 1 });

    expect(result.removed).toBeGreaterThan(0);
    // indexOf returning -1 is what tells the app to clear the selection instead of leaving
    // it pointed at whichever waypoint inherited the index.
    expect(path.waypoints.indexOf(tracked)).toBe(-1);
  });

  // Ranges from older project files name whole waypoints and carry no t0/t1.
  function legacyRangePath(anchorIndex: number): Path {
    return {
      waypoints: [0, 1, 2, 3, 4].map((step) => ({
        x: 1 + step * 2.2,
        y: 4,
        prevC: { x: 1 + step * 2.2 - 0.8, y: 4 },
        nextC: { x: 1 + step * 2.2 + 0.8, y: 4 },
        linked: true,
        theta: 0,
        thetaOn: step === 0 || step === 4,
        stop: false,
        segType: "bezier",
      })),
      ranges: [{ anchor: "wp", w0: anchorIndex, w1: anchorIndex }],
    };
  }

  it("keeps a legacy whole-waypoint range naming its waypoint when that waypoint survives", () => {
    const path = legacyRangePath(3);
    const anchored = path.waypoints[3];
    const before = anchorFraction(path, 3);

    // Merges near the start of the path, well away from the anchored waypoint.
    const result = brush().apply(path, { kind: "smooth", previous: { x: 3.1, y: 4 }, center: { x: 3.2, y: 4 }, radius: 1, strength: 1 });

    expect(result.removed).toBeGreaterThan(0);
    const range = path.ranges[0];
    expect(path.waypoints[range.w0]).toBe(anchored);
    expect(range.t0).toBeUndefined();
    expect(anchorFraction(path, range.w0, range.t0)).toBeCloseTo(before, 3);
  });

  it("holds a legacy range at its position when the brush merges the waypoint it names", () => {
    const path = legacyRangePath(2);
    const before = anchorFraction(path, 2);

    const result = brush().apply(path, { kind: "smooth", previous: { x: 5.4, y: 4 }, center: { x: 5.5, y: 4 }, radius: 1, strength: 1 });

    // The named waypoint is gone, so the range degrades to a local position rather than
    // snapping to whatever waypoint inherited the index.
    expect(result.removed).toBeGreaterThan(0);
    const range = path.ranges[0];
    expect(anchorFraction(path, range.w0, range.t0)).toBeCloseTo(before, 3);
  });

  it("reports whether a stroke changed anything", () => {
    const path = curvedPath();
    const pathBrush = brush();

    // Far from the path, so nothing is in range.
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 2, y: 7.5 }, center: { x: 2, y: 7.6 }, radius: 0.5, strength: 1 }).changed).toBe(false);
    expect(pathBrush.apply(path, { kind: "push", previous: { x: 5, y: 4 }, center: { x: 5, y: 4.1 }, radius: 1, strength: 1 }).changed).toBe(true);
  });

  it("twirls a path dragged diagonally", () => {
    // The old twirl scaled rotation by (dx - dy), which cancels exactly on a 45-degree
    // drag, so a diagonal gesture silently did nothing.
    const path = straightPath();
    const pathBrush = brush();
    pathBrush.apply(path, { kind: "push", previous: { x: 5.5, y: 4 }, center: { x: 5.5, y: 4.8 }, radius: 2, strength: 1 });

    const origin = { x: 5.5, y: 4.4 };
    const before = samplePath(path);
    // Match the first UI sample: origin and previous are identical, and the pointer moves
    // away with equal x and y components.
    pathBrush.apply(path, { kind: "twirl", origin, previous: origin, center: { x: 5.8, y: 4.7 }, radius: 2, strength: 0.8 });

    const after = samplePath(path);
    const moved = Math.max(...before.map((sample) => distanceToSamples(sample, after)));
    expect(moved).toBeGreaterThan(0.01);
  });
});
