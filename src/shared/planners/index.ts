import type { TrajectoryPlanner, TrajectoryPlannerId } from "../types";
import type { PlannerInput, PlannerResult } from "../types";
import { optimizedTrajectoryPlanner } from "./optimizedTrajectory";
import { profiledSplinePlanner } from "./profiledSpline";
import { applyStationaryActions } from "./stationaryActions";
import { applyRotationPriority } from "./rotationPriority";
import { effectivePathConstraints, robotHardLimits } from "../robotLimits";

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
      return applyStationaryActions(path, applyRotationPriority(path, generated, robot), robot);
    },
  };
}

export async function generateTrajectory(input: PlannerInput): Promise<PlannerResult> {
  const planner = getPlanner(input.plannerId ?? "profiledSpline");
  return planner.generate(input);
}
