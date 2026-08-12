import type { PlannerResult, TrajectoryPlanner, ValidationIssue } from "../types";
import { optimizePlannerResult, optimizationDiagnostics } from "./optimizationCore";
import { profiledSplinePlanner } from "./profiledSpline";

export const optimizedTrajectoryPlanner: TrajectoryPlanner = {
  id: "optimizedTrajectory",
  generate(input): PlannerResult {
    const started = performance.now();
    const base = profiledSplinePlanner.generate(input);
    const solveTimeMs = performance.now() - started;

    if (base.samples.length < 2) {
      const fallbackReason = "Profiled spline did not produce enough samples for optimization.";
      const issue: ValidationIssue = {
        severity: "warning",
        path: `paths.${input.path.name}.planner`,
        message: fallbackReason,
      };
      return {
        ...base,
        planner: "profiledSpline",
        diagnostics: [...base.diagnostics, issue],
        optimization: optimizationDiagnostics(input, base.samples, solveTimeMs, fallbackReason),
      };
    }

    try {
      return optimizePlannerResult(input, base, started);
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : "Optimizer failed.";
      const issue: ValidationIssue = {
        severity: "warning",
        path: `paths.${input.path.name}.planner`,
        message: `Optimized trajectory fell back to profiled spline: ${fallbackReason}`,
      };
      return {
        ...base,
        planner: "profiledSpline",
        diagnostics: [...base.diagnostics, issue],
        optimization: optimizationDiagnostics(input, base.samples, performance.now() - started, fallbackReason),
      };
    }
  },
};
