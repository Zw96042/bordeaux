      expect(final.samples[arrivals[3]].t).toBeGreaterThanOrEqual(final.samples[arrivals[2]].t + 1 - 1e-8);
      expect(final.samples[arrivals[4]].t).toBeGreaterThanOrEqual(final.samples[arrivals[3]].t + 2 - 1e-8);
    },
  );

  it("preserves heading interpolation at anchors, duplicates, and between anchors", () => {
    const anchors = [
      { f: 0, rad: -1 },
      { f: 0.2, rad: 0.5 },
      { f: 0.2, rad: 1 },
      { f: 0.75, rad: -2 },
      { f: 1, rad: 2 },
    ];
    expect(PM.headingAt(-0.1, anchors)).toBe(-1);
    expect(PM.headingAt(0.2, anchors)).toBeCloseTo(0.5, 10);
    expect(PM.headingAt(0.2 + 1e-7, anchors)).toBeCloseTo(1, 8);
    for (const fraction of [0, 0.75, 1]) {
      const expected = anchors.find((anchor) => anchor.f === fraction)!.rad;
      expect(PM.angWrap(PM.headingAt(fraction, anchors) - expected)).toBeCloseTo(0, 10);
    }
    expect(PM.angWrap(PM.headingAt(1.1, anchors) - 2)).toBeCloseTo(0, 10);
    // Duplicate anchors have a deliberate discontinuity; each nonempty span stays monotone.
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const start = anchors[index], end = anchors[index + 1];
      if (end.f === start.f) continue;
      const delta = PM.angWrap(end.rad - start.rad);
      let previous = 0;
      for (let tick = 1; tick <= 100; tick += 1) {
        const value = PM.headingAt(start.f + (end.f - start.f) * tick / 100, anchors);
        const progress = PM.angWrap(value - start.rad) / delta;
        expect(progress).toBeGreaterThanOrEqual(previous - 1e-8);
        expect(progress).toBeLessThanOrEqual(1 + 1e-8);
        previous = progress;
      }
    }
  });

  it("remaps authored waypoint boundaries through inserted range knots and adaptive refinement", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([
      { x: 1, y: 1, segType: "line" },
      { x: 5, y: 1, segType: "line", stop: true },
      { x: 9, y: 1, segType: "line" },
    ]);
    path.ranges = [{ anchor: "param", f0: 0.123, f1: 0.127, maxVel: 0.7,
      maxAccel: 2, maxDecel: 2, maxAngVel: 360, maxAngAccel: 720 }];
    const result = optimizedTrajectoryPlanner.generate({ path, robot: project.robot, samplesPerSegment: 4 });
    const arrivals = expectAuthoredArrivals(path, result);
    expect(result.samples.length).toBeGreaterThan(9);
    expect(result.samples.some((sample) => Math.abs(sample.f - 0.123) < 1e-6)).toBe(true);
    expect(result.samples.some((sample) => Math.abs(sample.f - 0.127) < 1e-6)).toBe(true);
    expect(result.samples[arrivals[1]].velocityMps).toBeCloseTo(0, 8);
    expect(result.samples[arrivals[1]].f).toBeCloseTo(0.5, 6);
  });

  it("does not rescan every trajectory sample for each turn boundary", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints(Array.from({ length: 128 }, (_, index) => ({
      x: 1 + index * 0.1,
      y: 4,
      stop: true,
      turnInPlace: { headingDeg: 0, direction: "shortest" as const },
    })));
    const samples: TrajectorySample[] = path.waypoints.map((waypoint, index) => ({
      i: index,
      t: index * 0.02,
      s: index * 0.1,
      f: index / (path.waypoints.length - 1),
      x: waypoint.x,
      y: waypoint.y,
      headingRad: 0,
      velocityMps: 0,
      accelerationMps2: 0,
      angularVelocityRadps: 0,
      curvatureInvM: 0,
    }));
    const result = {
      planner: "profiledSpline" as const,
      totalTimeS: samples.at(-1)!.t,
      totalDistanceM: samples.at(-1)!.s,
      samples,
      markers: [],
      diagnostics: [],
    };
    const hypot = vi.spyOn(Math, "hypot");
    try {
      expect(enforceAngularTiming(path, result)).toBe(result);
      expect(hypot.mock.calls.length).toBeLessThan(path.waypoints.length * 4);
    } finally {
      hypot.mockRestore();
    }
  });
});
