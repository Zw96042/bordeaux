  const project = createDemoProject();
  const path = project.paths[0];
  path.waypoints = buildWaypoints([
    { x: 0, y: 0, theta: 0, segType: "line" },
    { x: 4, y: 0, theta: 0 },
  ]);
  const samples: TrajectorySample[] = [0, 4].map((s, i) => ({
    i, s, f: s / 4, x: s, y: 0, t: s, headingRad: 0,
    velocityMps: 1, accelerationMps2: 0, angularVelocityRadps: 0, curvatureInvM: 0,
  }));
  const input = { path, robot: project.robot };
  expect(buildDenseValidationSamples(input, samples, 128).length).toBeLessThanOrEqual(1_000);
  expect(() => buildDenseValidationSamples(input, samples, 128, 8)).toThrow("Dense validation requires");
});
