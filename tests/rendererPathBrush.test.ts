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
