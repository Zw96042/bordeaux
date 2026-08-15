import type { PlannerResult, TrajectoryPlanner, TrajectoryPlannerId } from "../types";
import { optimizedTrajectoryPlanner } from "./optimizedTrajectory";
import { profiledSplinePlanner } from "./profiledSpline";
import { applyStationaryActions } from "./stationaryActions";
import { applyRotationPriority } from "./rotationPriority";
import { effectivePathConstraints, robotHardLimits } from "../robotLimits";
import { validateOptimizedTrajectory } from "./trajectoryValidation";

const EPSILON = 1e-9;

export function fixedPathSamples(result: PlannerResult) {
  let end = result.samples.length;
  while (end > 1
    && result.samples[end - 1].s - result.samples[end - 2].s <= EPSILON
    && result.samples[end - 1].t - result.samples[end - 2].t > EPSILON) {
    end -= 1;
  }
  return result.samples.slice(0, end);
}

export const planners: Record<TrajectoryPlannerId, TrajectoryPlanner> = {
  profiledSpline: profiledSplinePlanner,
  optimizedTrajectory: optimizedTrajectoryPlanner,
};

export function getPlanner(id: TrajectoryPlannerId): TrajectoryPlanner {
  const planner = planners[id];
  return {
    id: planner.id,
    generate(input) {
      const hardLimits = robotHardLimits(input.robot);
      const robot = hardLimits ? { ...input.robot, maxSpeed: hardLimits.maxSpeedMps } : input.robot;
      const constraints = effectivePathConstraints(input.path.constraints, robot);
      const path = constraints === input.path.constraints ? input.path : { ...input.path, constraints };
      const physicalInput = path === input.path && robot === input.robot ? input : { ...input, path, robot };
      const hasStationaryPause = path.waypoints.some((waypoint) => waypoint.turnInPlace || (waypoint.wait ?? 0) > 0);
      const planningInput = hasStationaryPause
        ? {
            ...physicalInput,
            path: {
              ...path,
              waypoints: path.waypoints.map((waypoint) => (waypoint.wait ?? 0) > 0 ? { ...waypoint, wait: 0 } : waypoint),
            },
          }
        : physicalInput;
      const generated = planner.generate(planningInput);
      let rotated = applyRotationPriority(path, generated, robot);
      if (planner.id === "optimizedTrajectory"
        && rotated !== generated
        && (rotated.optimization?.status === "optimal" || rotated.optimization?.status === "feasible")) {
        const validation = validateOptimizedTrajectory(planningInput, fixedPathSamples(rotated), {
          angularKinematics: "sample",
        });
        if (validation.violations.length > 0) {
          const reason = `Post-rotation validation found ${validation.violations.length} constraint violation${validation.violations.length === 1 ? "" : "s"}: ${validation.violations[0].message}`;
          const fallback = applyRotationPriority(path, profiledSplinePlanner.generate(planningInput), robot);
          rotated = {
            ...fallback,
            diagnostics: [...fallback.diagnostics, {
              severity: "warning",
              path: `paths.${path.name}.planner`,
              message: `Optimized trajectory fell back to profiled spline: ${reason}`,
            }],
            optimization: {
              ...rotated.optimization,
              plannerUsed: "profiledSpline",
              status: "internal-error",
              totalTimeS: fallback.totalTimeS,
              constraintViolations: validation.violations.length,
              fallback: true,
              fallbackReason: reason,
              validatedPoints: Math.max(rotated.optimization.validatedPoints ?? 0, validation.checkedPoints),
              activeConstraints: validation.activeConstraints,
            },
          };
        } else {
          rotated = {
            ...rotated,
            optimization: {
              ...rotated.optimization,
              status: "optimal",
              constraintViolations: 0,
              validatedPoints: Math.max(rotated.optimization.validatedPoints ?? 0, validation.checkedPoints),
              activeConstraints: [...new Set([
                ...(rotated.optimization.activeConstraints ?? []),
                ...validation.activeConstraints,
              ])].sort(),
            },
          };
        }
      }
      return applyStationaryActions(path, rotated, robot);
    },
  };
}
