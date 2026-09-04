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
