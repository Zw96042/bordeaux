    expect(PathPreview.directWorkIsSafe(RoutinePreview.directRoutineWork(routine, project.paths))).toBe(false);
  });

  it("rejects cumulative translation-priority heading work before derivation", () => {
    const project = createDemoProject();
    const path = project.paths[0];
    path.headingMode = "manual";
    path.waypoints = buildWaypoints(Array.from({ length: 900 }, (_, index) => ({
      x: 1 + index * 0.0001,
      y: 4,
      theta: index * 170,
      thetaOn: true,
      segType: "line",
      stop: index === 899,
    })));
    path.ranges = [{
      anchor: "param", f0: 0, f1: 1,
      maxVel: path.constraints.maxVel, maxAccel: path.constraints.maxAccel, maxDecel: path.constraints.maxDecel,
      maxAngVel: 180, maxAngAccel: 360, rotationPriority: "translation",
    }];
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: path.id }];
    expect(validateProject(project).ok).toBe(true);

    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    expect(admission).toMatchObject({
      allowed: false,
      estimate: { outputSamples: expect.any(Number) },
      error: { name: "RangeError" },
    });
    expect(admission.estimate.outputSamples).toBe(Infinity);
  });

  it("rejects malformed embedded previews without throwing during render admission", () => {
    const project = createDemoProject();
    const routine = project.routines[0];
    routine.nodes = [{ id: "generate", type: "function", cat: "generate", funcRef: "GeneratePath", preview: {} }];
    expect(validateProject(project).ok).toBe(true);

    expect(() => RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).not.toThrow();
    expect(RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).toMatchObject({
      allowed: false,
      estimate: null,
      error: { name: "RangeError", message: expect.stringMatching(/cannot be derived safely/) },
    });
  });

  it("admits bounded turns and jiggles while accounting for their samples", () => {
    const project = createDemoProject();
    const routine = project.routines[0];
    routine.nodes = [{ id: "path_node", type: "path", ref: project.paths[0].id }];
    const endpoint = project.paths[0].waypoints.at(-1);
    project.robot.maxSpeed = 0.5;
    project.paths[0].constraints = {
      ...project.paths[0].constraints,
      maxVel: 0.5,
      maxAccel: 0.5,
      maxDecel: 0.5,
      maxAngVel: 90,
      maxAngAccel: 180,
      maxAngDecel: 180,
      maxAngJerk: 360,
    };
    endpoint.stop = true;
    endpoint.turnInPlace = { headingDeg: 180, direction: "shortest" };
    endpoint.jiggle = { distanceM: 0.25, strokes: 4, startDeg: 0, stepDeg: 90, strokeTimeS: 0.08 };
    expect(validateProject(project).ok).toBe(true);

    const admission = RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot);
    const result = getPlanner("profiledSpline").generate({
      path: project.paths[0],
      robot: project.robot,
      samplesPerSegment: 56,
    });
    expect(admission.allowed).toBe(true);
    expect(admission.estimate.outputSamples).toBeGreaterThan(57);
    expect(admission.estimate.outputSamples).toBeLessThan(5_000);
    expect(result.samples.length).toBeLessThanOrEqual(admission.estimate.outputSamples);
  });

  it("rejects stationary actions outside the coarse safety floors", () => {
    const build = () => {
      const project = createDemoProject();
      const routine = project.routines[0];
      routine.nodes = [{ id: "path_node", type: "path", ref: project.paths[0].id }];
      const endpoint = project.paths[0].waypoints.at(-1);
      endpoint.stop = true;
      endpoint.turnInPlace = { headingDeg: 359, direction: "clockwise" };
      return { project, routine };
    };
    const lowDeceleration = build();
    lowDeceleration.project.paths[0].constraints.maxAngDecel = 0.0008;
    const lowJerk = build();
    lowJerk.project.paths[0].constraints.maxAngJerk = 0.000005;
    const lowPhysicalLimits = build();
    lowPhysicalLimits.project.robot.driveModel = {
      motorId: "slow",
      motorFreeRpm: 1,
      motorMaxTorqueNm: 1,
      motorCount: 4,
      gearRatio: 10,
      wheelDiameterM: 0.1,
      massKg: 50,
      moiKgM2: 10,
      wheelbaseM: 0.5,
      trackwidthM: 0.5,
      wheelFrictionCoefficient: 1,
    };

    [lowDeceleration, lowJerk, lowPhysicalLimits].forEach(({ project, routine }) => {
      expect(validateProject(project).ok).toBe(true);
      expect(RoutinePreview.workerRoutineAdmission(routine, project.paths, project.robot)).toMatchObject({
        allowed: false,
        estimate: { outputSamples: Infinity },
        error: { name: "RangeError", message: expect.stringMatching(/too large to preview safely/) },
      });
    });
  });

  it("returns a routine run without changing worker response contracts", () => {
    const buildRun = () => ({ steps: [{ node: { id: "path" }, t0: 0, t1: 2 }], segs: [], total: 2 });

    expect(processRoutinePreviewJob({ id: 17 }, buildRun)).toMatchObject({
      id: 17,
      value: { total: 2 },
      durationMs: expect.any(Number),
    });
  });

  it("serializes worker failures", () => {
    const result = processRoutinePreviewJob({ id: 18 }, () => { throw new Error("bad routine"); });

    expect(result).toMatchObject({ id: 18, error: { name: "Error", message: "bad routine" } });
  });
});
