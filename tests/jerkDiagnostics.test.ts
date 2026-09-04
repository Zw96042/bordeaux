    maxAccel: 10,
    maxDecel: 10,
    maxAngVel: 360,
    maxAngAccel: 720,
  };
  path.waypoints = buildWaypoints([
    { x: 1, y: 2, theta: 0, thetaOn: true, segType: "line" },
    { x: 8, y: 2, theta: 180, thetaOn: true },
  ]);
  return project;
}

function generatedCatalog(): JavaCommandCatalog {
  return {
    projectName: "CompetitionRobot",
    sourceFileCount: 1,
    scannedAt: "2026-08-12T00:00:00.000Z",
    source: "generated",
    runtimeCommandCount: 0,
    generatedSchemaVersion: "1.0",
    catalogId: "competition-robot",
    supportVersion: "0.2.0-beta.3",
    catalogHash: `sha256:${"a".repeat(64)}`,
    authoritative: true,
    warnings: [],
    commands: [],
  };
}

describe("final trajectory jerk diagnostics", () => {
  it.each(PLANNERS)("reports moving linear jerk violations in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.constraints.maxJerk = 0.1;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(measuredLinearJerk(result.samples)).toBeGreaterThan(path.constraints.maxJerk);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      path: `paths.${path.name}.constraints.maxJerk`,
      message: expect.stringContaining("Linear jerk"),
    }));
    if (result.optimization) expect(result.optimization.constraintViolations).toBeGreaterThan(0);
  });

  it.each(PLANNERS)("slows moving rotation to honor angular jerk in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.constraints.maxAngJerk = 1;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    // The coupled solver may now recover by giving rotation more time.
    expect(measuredAngularJerk(result.samples)).toBeLessThanOrEqual(path.constraints.maxAngJerk + 1e-9);
    expect(result.diagnostics.some((issue) => issue.severity === "error")).toBe(false);
    expect(result.samples.at(-1)!.headingRad).toBeCloseTo(Math.PI, 5);
  });

  it.each(PLANNERS)("preserves jerk-constrained stationary turns in %s", (plannerId) => {
    const project = movingProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints[1].theta = 0;
    path.waypoints[1].stop = true;
    path.waypoints[1].turnInPlace = { headingDeg: 90, direction: "counterclockwise" };
    path.constraints.maxAngJerk = 120;

    const result = getPlanner(plannerId).generate({ path, robot: project.robot });

    expect(result.diagnostics.some((issue) => issue.message.includes("Angular jerk"))).toBe(false);
    expect(result.samples.at(-1)!.headingRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it("measures angular jerk between interval midpoints on nonuniform samples", () => {
    const project = movingProject();
    const path = project.paths[0];
    path.constraints.maxAngJerk = 65;
    const sample = (i: number, t: number, angularVelocityRadps: number): TrajectorySample => ({
      i, t, angularVelocityRadps,
      s: 0, f: i / 2, x: 0, y: 0, headingRad: 0,
      velocityMps: 0, accelerationMps2: 0, curvatureInvM: 0,
    });
    const result = addJerkDiagnostics(path, {
      planner: "profiledSpline",
      totalTimeS: 3,
      totalDistanceM: 0,
      samples: [sample(0, 0, 0), sample(1, 1, 0), sample(2, 3, 4)],
      markers: [],
      diagnostics: [],
    } satisfies PlannerResult);

    expect(result.diagnostics).toContainEqual({
      severity: "error",
      path: `paths.${path.name}.constraints.maxAngJerk`,
      message: "Angular jerk reaches 76.394 °/s³, above the maxAngJerk limit of 65.000 °/s³",
    });
  });

  it.each(PLANNERS)("blocks native and Java export when %s violates maxJerk", (plannerId) => {
    const project = movingProject();
    project.plannerId = plannerId;
    project.paths[0].headingMode = "tangent";
    project.paths[0].constraints.maxJerk = 0.1;

    expect(() => buildBdxExport(project)).toThrow(/Linear jerk|nonzero translational jerk/);
    expect(() => buildJavaTrajectory(project, generatedCatalog())).toThrow(/Linear jerk|nonzero translational jerk/);
  });

  it.each(PLANNERS)("exports angular-jerk-compliant native and Java samples from %s", (plannerId) => {
    const project = movingProject();
    project.plannerId = plannerId;
    project.paths[0].headingMode = "manual";
    project.paths[0].constraints.maxAngJerk = 1;

    const native = buildBdxExport(project).paths[0];
    const java = buildJavaTrajectory(project, generatedCatalog()).document.paths[0];
    expect(measuredAngularJerk(native.samples)).toBeLessThanOrEqual(1 + 1e-9);
    expect(measuredAngularJerk(java.samples)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
