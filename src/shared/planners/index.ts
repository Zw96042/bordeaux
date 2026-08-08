import type { TrajectoryPlanner, TrajectoryPlannerId } from "../types";
import type { PlannerInput, PlannerResult } from "../types";
import { optimizedTrajectoryPlanner } from "./optimizedTrajectory";
import { profiledSplinePlanner } from "./profiledSpline";
import { labviewBezierPlanner, labviewClothoidPlanner } from "./labviewCompatible";
import { applyStationaryActions } from "./stationaryActions";
import { applyRotationPriority } from "./rotationPriority";

export const planners: Record<TrajectoryPlannerId, TrajectoryPlanner> = {
  profiledSpline: profiledSplinePlanner,
  optimizedTrajectory: optimizedTrajectoryPlanner,
  labviewBezier: labviewBezierPlanner,
  labviewClothoid: labviewClothoidPlanner,
};

export function getPlanner(id: TrajectoryPlannerId): TrajectoryPlanner {
  const planner = planners[id];
  return {
    id: planner.id,
    generate(input) {
      const hasStationaryPause = input.path.waypoints.some((waypoint) => waypoint.turnInPlace || (waypoint.wait ?? 0) > 0);
      const planningInput = hasStationaryPause
        ? {
            ...input,
            path: {
              ...input.path,
              waypoints: input.path.waypoints.map((waypoint) => (waypoint.wait ?? 0) > 0 ? { ...waypoint, wait: 0 } : waypoint),
            },
          }
        : input;
      const generated = planner.generate(planningInput);
      return applyStationaryActions(input.path, applyRotationPriority(input.path, generated, input.robot), input.robot);
    },
  };
}

export async function generateTrajectory(input: PlannerInput): Promise<PlannerResult> {
  const planner = getPlanner(input.plannerId ?? "profiledSpline");
  return planner.generate(input);
}
