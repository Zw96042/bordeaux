
describe("explicit accepted optimization", () => {
  it("preserves the exact applied output through save and reopen", () => {
    const reopened = decodeProjectFile(encodeProjectFile(selectedProject()).contents).project;
    const restored = reopened.paths.find((candidate) => candidate.id === path.id)!;
    expect(getAcceptedTrajectory(restored, reopened.robot)).toEqual(result);
    expect(restored.optimization!.accepted!.result.samples).toEqual(result.samples);
    expect(restored.optimization!.accepted!.result.optimizedPath?.optimization).toBeUndefined();
  });

  it("exports accepted samples and markers without another geometry search", () => {
    const exported = buildBdxExport(selectedProject()).paths[0];
    expect(exported.samples).toEqual(result.samples);
    expect(exported.markers).toEqual(result.markers);
    expect(exported.totalTimeS).toBe(result.totalTimeS);
  });

  it("ignores cosmetic path properties and robot editor hints in input identity", () => {
    const cosmetic = { ...selected, id: "renamed-id", name: "Renamed", folderId: "folder", exportable: false, _selM: 0 };
    expect(optimizationInputKey(cosmetic, { ...project.robot, footprintPreset: { kind: "custom" }, planning: { notes: "Team notes" } })).toBe(optimizationInputKey(path, project.robot));
    expect(getAcceptedTrajectory(cosmetic, project.robot)).toEqual(result);
  });

  it("invalidates geometry, constraints, robot limits, field revisions, and corridor edits", () => {
    const changed = structuredClone(selected);
    changed.waypoints[0].x += 0.01;
    expect(getAcceptedTrajectory(changed, project.robot)).toBeNull();
    expect(isOptimizationOutdated(changed, project.robot)).toBe(true);
    const constrained = { ...selected, constraints: { ...selected.constraints, maxVel: 0.5 } };
    expect(getAcceptedTrajectory(constrained, project.robot)).toBeNull();
    expect(isOptimizationOutdated(constrained, project.robot)).toBe(true);
    expect(getAcceptedTrajectory(selected, { ...project.robot, maxSpeed: 0.5 })).toBeNull();
    expect(isOptimizationOutdated(selected, { ...project.robot, maxSpeed: 0.5 })).toBe(true);
    expect(getAcceptedTrajectory(selected, project.robot, { ...project.field, revision: "future" })).toBeNull();
    expect(isOptimizationOutdated(selected, project.robot, { ...project.field, revision: "future" })).toBe(true);
    expect(getAcceptedTrajectory({ ...selected, optimization: { ...selected.optimization!, corridorM: 0.3 } }, project.robot)).toBeNull();
    expect(isOptimizationOutdated({ ...selected, optimization: { ...selected.optimization!, corridorM: 0.3 } }, project.robot)).toBe(true);
  });

  it.each(["geometry", "robot"])("uses current normal samples and timing after %s edits", (edit) => {
    const changed = selectedProject();
    const changedPath = changed.paths.find((candidate) => candidate.id === selected.id)!;
    if (edit === "geometry") changedPath.waypoints[0].x += 0.01;
    else changed.robot.maxSpeed -= 0.1;
    expect(isOptimizationOutdated(changedPath, changed.robot, changed.field)).toBe(true);
    expect(getAcceptedTrajectory(changedPath, changed.robot, changed.field)).toBeNull();
    const normal = getPlanner("profiledSpline").generate({ path: authoredPath(changedPath), robot: changed.robot });
    const exported = buildBdxExport(changed).paths[0];
    expect(exported.samples).toEqual(normal.samples);
    expect(exported.totalTimeS).toBe(normal.totalTimeS);
    expect(exported.markers).toEqual(normal.markers);
    expect(changedPath.optimization!.accepted!.result).toEqual(selected.optimization!.accepted!.result);
  });

  it("distinguishes outdated identity from missing selection and corrupt current-input output", () => {
    expect(isOptimizationOutdated(path, project.robot)).toBe(false);
    expect(isOptimizationOutdated(selected, project.robot)).toBe(false);
    const tampered = selectedProject();
    const tamperedPath = tampered.paths.find((candidate) => candidate.id === selected.id)!;
    // Marker tampering passes structural validation but fails accepted-result validation.
    tamperedPath.optimization!.accepted!.result.markers[0].command = "tampered";
    expect(isOptimizationOutdated(tamperedPath, tampered.robot)).toBe(false);
    expect(() => buildBdxExport(tampered)).toThrow(/applied optimization is invalid/i);
  });

  it("loads legacy optimized project settings with a normal selection", () => {
    const legacy = selectedProject();
    legacy.plannerId = "optimizedTrajectory";
    legacy.paths = legacy.paths.map(authoredPath);
    const normal = { ...legacy, plannerId: "profiledSpline" as const };
    expect(buildBdxExport(decodeProjectFile(encodeProjectFile(legacy).contents).project).paths[0].samples).toEqual(buildBdxExport(normal).paths[0].samples);
  });

  it("preserves stationary actions and refuses forged action samples or wait durations", () => {
    const stopped = structuredClone(project.paths.find((candidate) => candidate.id === "corpus-neutral-stop")!);
    const output = optimizeCorridorFinal({ path: stopped, robot: project.robot });
    const applied = { ...stopped, optimization: { corridorM: 0.15, accepted: createAcceptedTrajectory(stopped, project.robot, output) } };
    expect(getAcceptedTrajectory(applied, project.robot)?.stationaryActions).toEqual(output.stationaryActions);
    const shifted = structuredClone(applied);
    const action = shifted.optimization.accepted.result.stationaryActions!.find((item) => item.kind === "wait")!;
    const sample = shifted.optimization.accepted.result.samples.find((item) => item.t > action.startTimeS && item.t < action.endTimeS)!;
    sample.x += 0.03;
    expect(getAcceptedTrajectory(shifted, project.robot)).toBeNull();
    const longer = structuredClone(applied);
    longer.optimization.accepted.result.stationaryActions!.find((item) => item.kind === "wait")!.endTimeS += 0.2;
    expect(getAcceptedTrajectory(longer, project.robot)).toBeNull();
  }, 15_000);

  it("rejects malformed samples before any physical validation", () => {
    const malformed = structuredClone(selectedProject());
    const artifact = malformed.paths.find((candidate) => candidate.id === selected.id)!.optimization!.accepted!;
    artifact.result.samples[1].t = Number.NaN;
    expect(acceptedTrajectoryShapeError(artifact)).toMatch(/finite and ordered/);
    expect(validateProject(malformed).ok).toBe(false);
    expect(() => encodeProjectFile(malformed)).toThrow(/Accepted trajectory/);
  });

  it("does not trust a matching identity after stored output is changed", () => {
    for (const mutate of [
      (output: PlannerResult) => { output.samples[10].x += 1; },
      (output: PlannerResult) => { output.samples[10].velocityMps = 100; },
      (output: PlannerResult) => { output.samples.forEach((sample) => { sample.velocityMps = 0; }); },
      (output: PlannerResult) => { output.optimizedPath!.waypoints[0].x += 0.02; },
      (output: PlannerResult) => { output.markers[0].command = "tampered"; },
    ]) {
      const tampered = structuredClone(selected);
      mutate(tampered.optimization!.accepted!.result);
      expect(getAcceptedTrajectory(tampered, project.robot)).toBeNull();
    }
  });
});
