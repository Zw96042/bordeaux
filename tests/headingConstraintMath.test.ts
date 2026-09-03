    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "targets";
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 8, y: 0, theta: 100 },
    ]);
    path.targets = [{ f: 0.301, deg: 20 }, { f: 0.607, deg: 65 }];
    const input = { path, robot: project.robot, samplesPerSegment: 56 };
    const seed = profiledSplineOptimizationSeed(input);
    const samples = insertOptimizationBoundaries(input, seed.samples);
    for (const sample of seed.samples) {
      const actual = samples.find((candidate) => candidate.f === sample.f)!;
      expect(actual.headingRad).toBeCloseTo(sample.headingRad, 10);
    }
  });

  it("differentiates heading at the sample position on an uneven distance grid", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.waypoints = buildWaypoints([
      { x: 0, y: 0, theta: 0, segType: "line" },
      { x: 4, y: 0, theta: 0 },
    ]);
    const samples: TrajectorySample[] = [0, 0.5, 0.99, 1, 1.5, 2, 3, 4].map((s, i) => ({
      i, s, f: s / 4, x: s, y: 0, t: s,
      headingRad: 0.1 * s * s, velocityMps: 1, accelerationMps2: 0,
      angularVelocityRadps: 0.2 * s, curvatureInvM: 0,
    }));
    const state = buildCanonicalPathState(path, samples);
    for (const point of state.points.slice(2, -2)) {
      expect(point.headingDerivativeRadPerM).toBeCloseTo(0.2 * point.s, 10);
      expect(point.headingSecondDerivativeRadPerM2).toBeCloseTo(0.2, 10);
    }
  });
});
