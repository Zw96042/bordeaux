  const constraintIssue: ValidationIssue[] = optimization.constraintViolations > 0 ? [{
    severity: "error",
    path: `paths.${input.path.name}.planner`,
    message: `Optimized trajectory has ${optimization.constraintViolations} final linear constraint violation${optimization.constraintViolations === 1 ? "" : "s"}.`,
  }] : [];

  return enforceAngularTiming(input.path, {
    ...result,
    diagnostics: [...base.diagnostics, ...constraintIssue],
    optimization,
  });
}
