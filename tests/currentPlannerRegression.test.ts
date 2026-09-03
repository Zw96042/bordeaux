      expect(sample.headingRad).toBeCloseTo(withoutTarget.samples[index].headingRad, 8);
      expect(sample.t).toBeCloseTo(withoutTarget.samples[index].t, 8);
    });
  });

  it("keeps close heading targets as distinct exact trajectory knots", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "targets";
    path.waypoints = buildWaypoints([
      { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
      {
        x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "targets",
      },
      {
        x: 7, y: 2, theta: 0, thetaOn: true, stop: true,
        turnInPlace: { headingDeg: 0, direction: "shortest" },
      },
    ]);
    path.targets = [{ f: 0.55, deg: 90 }, { f: 0.551, deg: -90 }];

    const result = getPlanner("profiledSpline").generate({
      path, robot: project.robot, samplesPerSegment: 56,
    });

    expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
    for (const target of path.targets) {
      const sample = result.samples.find((candidate) => Math.abs(candidate.f - target.f) <= 1e-9);
      expect(sample).toBeDefined();
      expect(Math.abs(PM.angWrap(sample!.headingRad - target.deg * Math.PI / 180))).toBeLessThan(0.05 * Math.PI / 180);
    }
  });

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "hits an active heading target while translating with %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "targets";
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "targets" },
        { x: 7, y: 2, theta: 90, thetaOn: true },
      ]);
      path.targets = [{ f: 0.75, deg: 90 }];

      const result = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 56 });
      const target = result.samples.reduce((nearest, sample) => (
        Math.abs(sample.f - 0.75) < Math.abs(nearest.f - 0.75) ? sample : nearest
      ));

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(Math.abs(PM.angWrap(target.headingRad - Math.PI / 2))).toBeLessThan(0.1 * Math.PI / 180);
      expect(target.velocityMps).toBeGreaterThan(0.5);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "hits an off-grid heading target at its exact authored fraction with %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "targets";
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
        { x: 4, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "targets" },
        { x: 8, y: 2, theta: 90, thetaOn: true },
      ]);
      const targetFraction = 0.5664265306122449;
      path.targets = [{ f: targetFraction, deg: 90 }];

      const result = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 56 });
      const target = result.samples.find((sample) => Math.abs(sample.f - targetFraction) < 1e-9);

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(target).toBeDefined();
      expect(Math.abs(PM.angWrap(target!.headingRad - Math.PI / 2))).toBeLessThan(0.1 * Math.PI / 180);
      expect(target!.velocityMps).toBeGreaterThan(0.5);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "tracks a continuous LookAt law while translating with %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.constraints.maxAngVel = 720;
      path.constraints.maxAngAccel = 1_440;
      path.constraints.maxAngDecel = 1_440;
      path.waypoints = buildWaypoints([
        { x: 0, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
        {
          x: 2, y: 2, theta: 0, thetaOn: true, segType: "line",
          segmentHeadingMode: "lookAt", segmentLookAt: { x: 4, y: 5 },
        },
        { x: 10, y: 2, theta: 180, thetaOn: true },
      ]);

      const result = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 56 });
      const sample = result.samples.reduce((nearest, candidate) => (
        Math.abs(candidate.x - 6) < Math.abs(nearest.x - 6) ? candidate : nearest
      ));
      const expected = Math.atan2(5 - sample.y, 4 - sample.x);

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(Math.abs(PM.angWrap(sample.headingRad - expected))).toBeLessThan(0.25 * Math.PI / 180);
      expect(sample.velocityMps).toBeGreaterThan(0.5);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "tracks the geometric tangent throughout an outgoing curved segment with %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.waypoints = buildWaypoints([
        { x: 0, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "manual" },
        {
          x: 4, y: 2, theta: 0, thetaOn: true, segType: "bezier",
          nextC: { x: 5, y: 2 }, prevC: { x: 3, y: 2 }, segmentHeadingMode: "tangent",
        },
        { x: 8, y: 4, theta: 0, thetaOn: true, prevC: { x: 7, y: 4 } },
      ]);

      const result = getPlanner(plannerId).generate({ path, robot: project.robot, samplesPerSegment: 56 });
      const index = result.samples.reduce((nearest, sample, candidateIndex) => (
        Math.abs(sample.x - 6) < Math.abs(result.samples[nearest].x - 6) ? candidateIndex : nearest
      ), 1);
      const before = result.samples[index - 1];
      const sample = result.samples[index];
      const after = result.samples[index + 1];
      const tangent = Math.atan2(after.y - before.y, after.x - before.x);

      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
      expect(Math.abs(PM.angWrap(sample.headingRad - tangent))).toBeLessThan(1 * Math.PI / 180);
      expect(sample.velocityMps).toBeGreaterThan(0.5);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "keeps a later Targets law out of an earlier equivalent transition in %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.constraints.maxAngVel = 360;
      path.constraints.maxAngAccel = 720;
      path.constraints.maxAngDecel = 720;
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
        {
          x: 3, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "manual",
          headingTransition: { placement: "after", rotationPriority: "translation", distanceM: 0.75 },
        },
        {
          x: 5, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "targets",
          headingTransition: { placement: "after", rotationPriority: "translation", distanceM: 0.75 },
        },
        { x: 7, y: 2, theta: 180, thetaOn: true },
      ]);

      const result = getPlanner(plannerId).generate({
        path, robot: project.robot, samplesPerSegment: 56,
      });
      const firstWaypoint = result.samples.reduce((nearest, sample) => (
        Math.abs(sample.x - 3) < Math.abs(nearest.x - 3) ? sample : nearest
      ));

      expect(Math.abs(firstWaypoint.headingRad)).toBeLessThan(1 * Math.PI / 180);
      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "preserves an exact heading anchor before the next law in %s",
    (plannerId) => {
      const project = createDemoProject();
      const path = project.paths[0];
      path.headingMode = "manual";
      path.constraints.maxAngVel = 360;
      path.constraints.maxAngAccel = 720;
      path.constraints.maxAngDecel = 720;
      path.waypoints = buildWaypoints([
        { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "tangent" },
        {
          x: 3, y: 2, theta: 0, thetaOn: true, segType: "line", segmentHeadingMode: "manual",
        },
        {
          x: 5, y: 2, theta: 90, thetaOn: true, segType: "line", segmentHeadingMode: "tangent",
        },
        { x: 7, y: 2, theta: 0, thetaOn: true },
      ]);

      const result = getPlanner(plannerId).generate({
        path, robot: project.robot, samplesPerSegment: 14,
      });
      const anchor = result.samples.reduce((nearest, sample) => (
        Math.abs(sample.x - 5) < Math.abs(nearest.x - 5) ? sample : nearest
      ));

      expect(Math.abs(PM.angWrap(anchor.headingRad - Math.PI / 2))).toBeLessThan(0.05 * Math.PI / 180);
      expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
    },
  );

});
