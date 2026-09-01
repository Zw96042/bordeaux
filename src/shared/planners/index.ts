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
          if (!retimed) break;
          timingBase = retimed;
          rotated = applyRotationPriority(path, timingBase, robot);
          validation = validateOptimizedTrajectory(planningInput, rotated.samples, {
            angularKinematics: "sample",
          });
          rotationError = rotated.diagnostics.find((issue) => issue.severity === "error");
        }
        const permitsBoundedWholePathRecovery = (path.startVel ?? 0) > EPSILON
          || (path.goalVel ?? 0) > EPSILON
          || (path.constraints.maxAngJerk ?? 0) > 0;
        if (permitsBoundedWholePathRecovery && (validation.violations.length > 0 || rotationError)) {
          const minimumScale = (path.constraints.maxAngJerk ?? 0) > 0 ? 0.01 : 0.4;
          for (let timingScale = 0.9; timingScale >= minimumScale; timingScale *= 0.9) {
            const slowed = applyRotationPriority(path, scaleTrajectoryTiming(timingBase, timingScale), robot);
            const slowedValidation = validateOptimizedTrajectory(planningInput, slowed.samples, {
              angularKinematics: "sample",
            });
            const slowedRotationError = slowed.diagnostics.find((issue) => issue.severity === "error");
            if (slowedValidation.violations.length === 0 && !slowedRotationError) {
              rotated = slowed;
              validation = slowedValidation;
              rotationError = undefined;
              break;
            }
          }
        }
        const failureReason = rotationError?.message
          ?? (validation.violations.length > 0
            ? `Coupled trajectory validation found ${validation.violations.length} constraint violation${validation.violations.length === 1 ? "" : "s"}: ${validation.violations[0].message}`
            : undefined);
        if (planner.id === "profiledSpline") {
          if (failureReason) {
            rotated = {
              ...rotated,
              diagnostics: [...rotated.diagnostics, {
                severity: "error",
                path: `paths.${path.name}.planner`,
                message: failureReason,
              }],
            };
          }
          return addAngularLimitDiagnostics(path, addJerkDiagnostics(path, applyStationaryActions(path, rotated, robot)));
        }

        const optimization = rotated.optimization ?? generated.optimization!;
        if (validation.violations.length > 0 || rotationError) {
          const reason = failureReason!;
          const fallback = applyRotationPriority(path, profiledSplinePlanner.generate(planningInput), robot);
          rotated = {
            ...fallback,
            diagnostics: [...fallback.diagnostics, {
              severity: "warning",
              path: `paths.${path.name}.planner`,
              message: `Optimized trajectory fell back to profiled spline: ${reason}`,
            }],
            optimization: {
              ...optimization,
              plannerUsed: "profiledSpline",
              status: "internal-error",
              totalTimeS: fallback.totalTimeS,
              constraintViolations: validation.violations.length,
              fallback: true,
              fallbackReason: reason,
              validatedPoints: Math.max(optimization.validatedPoints ?? 0, validation.checkedPoints),
              activeConstraints: validation.activeConstraints,
            },
          };
        } else {
          rotated = {
            ...rotated,
            optimization: {
              ...optimization,
              status: optimization.status,
              constraintViolations: 0,
              validatedPoints: Math.max(optimization.validatedPoints ?? 0, validation.checkedPoints),
              activeConstraints: [...new Set([
                ...(optimization.activeConstraints ?? []),
                ...validation.activeConstraints,
              ])].sort(),
            },
          };
          if (!path.waypoints.some((waypoint) => waypoint.turnInPlace || waypoint.jiggle)) {
            const profiled = getPlanner("profiledSpline").generate({
              ...planningInput,
              samplesPerSegment: (planningInput.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT) * 2,
            });
            const profiledValidation = validateOptimizedTrajectory(
              input,
              fixedPathSamples(profiled),
              { angularKinematics: "sample" },
            );
            if (profiled.totalTimeS < rotated.totalTimeS - EPSILON
              && profiledValidation.violations.length === 0
              && !profiled.diagnostics.some((issue) => issue.severity === "error")) {
              rotated = {
                ...profiled,
                optimization: {
                  ...rotated.optimization!,
                  ...profiled.optimization,
                  // This candidate started at twice the caller's resolution.
                  refinementPasses: (profiled.optimization?.refinementPasses ?? 0) + 1,
                  plannerUsed: "profiledSpline",
                  status: "equivalent",
                  totalTimeS: profiled.totalTimeS,
                  maxVelocityMps: Math.max(...profiled.samples.map((sample) => Math.abs(sample.velocityMps))),
                  maxAccelerationMps2: Math.max(...profiled.samples.map((sample) => Math.abs(sample.accelerationMps2))),
                  constraintViolations: 0,
                  fallback: false,
                  fallbackReason: undefined,
                },
              };
            }
          }
        }
      }
      return addAngularLimitDiagnostics(path, addJerkDiagnostics(path, applyStationaryActions(path, rotated, robot)));
    },
  };
}
