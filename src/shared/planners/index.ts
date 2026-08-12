import type { TrajectoryPlanner, TrajectoryPlannerId } from "../types";
import { optimizedTrajectoryPlanner } from "./optimizedTrajectory";
import { profiledSplinePlanner } from "./profiledSpline";
import { finalizePlannerResult, preparePlannerInput } from "./pipeline";

export const planners: Record<TrajectoryPlannerId, TrajectoryPlanner> = {
  profiledSpline: profiledSplinePlanner,
  optimizedTrajectory: optimizedTrajectoryPlanner,
};

export function getPlanner(id: TrajectoryPlannerId): TrajectoryPlanner {
  const planner = planners[id];
  return {
    id: planner.id,
    generate(input) {
      const prepared = preparePlannerInput(input);
      return finalizePlannerResult(prepared.path, prepared.robot, planner.generate(prepared.planningInput));
    },
  };
}
