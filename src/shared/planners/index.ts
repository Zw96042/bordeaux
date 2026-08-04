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
