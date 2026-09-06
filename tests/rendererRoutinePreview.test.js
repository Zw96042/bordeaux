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
