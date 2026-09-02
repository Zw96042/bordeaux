import { ACTIVE_FIELD_REFERENCE } from "../field/rebuilt2026";
import { clone } from "../project/defaults";
import { effectivePathConstraints, robotHardLimits } from "../robotLimits";
import type { FieldReference, PathDoc, PlannerResult, RobotConfig } from "../types";
import { validateCorridorCandidate } from "./corridorFinal";
import { invariantFailure, validateFinal } from "./fixedGeometryFinal";
import { getPlanner } from "./index";
import { DEFAULT_SAMPLES_PER_SEGMENT } from "./limits";
import { acceptedTrajectoryShapeError, authoredPath, optimizationInputKey, optimizationIntentKey } from "./acceptedTrajectoryIdentity";

export { acceptedTrajectoryShapeError, authoredPath, optimizationInputKey } from "./acceptedTrajectoryIdentity";
type AcceptedTrajectory = NonNullable<NonNullable<PathDoc["optimization"]>["accepted"]>;

function markersMatch(path: PathDoc, result: PlannerResult): boolean {
  if (result.markers.length !== path.markers.length) return false;
  return path.markers.every((marker, index) => {
    const saved = result.markers[index];
    const fraction = marker.anchor === "dist" && result.totalDistanceM > 1e-9
      ? Math.max(0, Math.min(1, (marker.d ?? marker.f * result.totalDistanceM) / result.totalDistanceM)) : marker.f;
    if (saved.id !== marker.id || saved.name !== marker.name || saved.command !== (marker.cmd ?? null)
      || saved.group !== (marker.group ?? null) || JSON.stringify(saved.invocation) !== JSON.stringify(marker.invocation)
      || Math.abs(saved.fraction - fraction) > 1e-5) return false;
    // Events at an arrival precede waits/turns, except terminal events, which follow them.
    const after = fraction >= 1 ? result.samples.at(-1)! : result.samples.find((sample) => sample.f >= fraction)!;
    const before = result.samples[Math.max(0, after.i - 1)];
    const progress = after.f === before.f ? 0 : (fraction - before.f) / (after.f - before.f);
    const expectedTime = fraction >= 1 ? after.t : before.t + (after.t - before.t) * progress;
    return Math.abs(saved.timeS - expectedTime) < 0.002;
  });
}

function stationaryActionsMatch(path: PathDoc, robot: RobotConfig, result: PlannerResult): boolean {
  const actions = result.stationaryActions ?? [];
  const physicalRobot = { ...robot, maxSpeed: robotHardLimits(robot)?.maxSpeedMps ?? robot.maxSpeed };
  const limits = effectivePathConstraints(path.constraints, physicalRobot);
  for (const action of actions) {
    const waypoint = path.waypoints[action.waypointIndex];
    if (!waypoint || action.kind === "jiggle") return false;
    if (action.kind === "wait" && Math.abs(action.endTimeS - action.startTimeS - (waypoint.wait ?? 0)) > 0.021) return false;
    const stationary = result.samples.filter((sample) => sample.t >= action.startTimeS - 1e-6 && sample.t <= action.endTimeS + 1e-6);
    if (stationary.length < 2 || stationary.some((sample) => Math.hypot(sample.x - waypoint.x, sample.y - waypoint.y) > 0.001
      || Math.abs(sample.velocityMps) > 0.001 || Math.abs(sample.f - action.fraction) > 1e-5)) return false;
    for (let index = 1; index < stationary.length; index += 1) {
      const before = stationary[index - 1], sample = stationary[index];
      const velocity = Math.atan2(Math.sin(sample.headingRad - before.headingRad), Math.cos(sample.headingRad - before.headingRad)) / (sample.t - before.t);
      if ((action.kind === "wait" && Math.abs(velocity) > 0.001)
        || Math.abs(velocity) > limits.maxAngVel * Math.PI / 180 + 0.002) return false;
    }
    if (action.kind === "turn" && waypoint.turnInPlace) {
      const target = waypoint.turnInPlace.headingDeg * Math.PI / 180 + (path.driveBackward ? Math.PI : 0);
      const delta = stationary.at(-1)!.headingRad - target;
      if (Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > 0.001) return false;
    }
  }
  return path.waypoints.every((waypoint, index) => !(waypoint.wait ?? 0)
    || actions.some((action) => action.kind === "wait" && action.waypointIndex === index));
}

export function getAcceptedTrajectory(path: PathDoc, robot: RobotConfig, field: FieldReference = ACTIVE_FIELD_REFERENCE): PlannerResult | null {
  const accepted = path.optimization?.accepted;
  if (!accepted) return null;
  try {
    if (accepted.inputKey !== optimizationInputKey(path, robot, field)) return null;
    if (acceptedTrajectoryShapeError(accepted)) return null;
    const result = accepted.result;
    const authored = authoredPath(path);
    const geometry = result.optimizedPath ?? authored;
    if (optimizationIntentKey(authored) !== optimizationIntentKey(geometry) || !markersMatch(authored, result) || !stationaryActionsMatch(authored, robot, result)) return null;
    const input = { path: geometry, robot, samplesPerSegment: accepted.samplesPerSegment };
    const baseline = getPlanner("profiledSpline").generate({ ...input, path: authored });
    const geometryReference = geometry === authored ? baseline : getPlanner("profiledSpline").generate(input);
    if (invariantFailure(input, geometryReference, result) || validateFinal(input, result).failure) return null;
    if (!validateCorridorCandidate({ ...input, path: authored }, result, { corridorM: path.optimization?.corridorM ?? 0.15 }, baseline)) return null;
    return result;
  } catch {
    // Invalid current-input artifacts require explicit review at the export boundary.
    return null;
  }
}

export function createAcceptedTrajectory(
  path: PathDoc,
  robot: RobotConfig,
  result: PlannerResult,
  field: FieldReference = ACTIVE_FIELD_REFERENCE,
  samplesPerSegment = DEFAULT_SAMPLES_PER_SEGMENT,
): AcceptedTrajectory {
  const accepted: AcceptedTrajectory = {
    version: 1,
    inputKey: optimizationInputKey(path, robot, field),
    samplesPerSegment,
    result: clone({ ...result, optimizedPath: result.optimizedPath ? authoredPath(result.optimizedPath) : undefined }),
  };
  const selected = { ...path, optimization: { corridorM: path.optimization?.corridorM ?? 0.15, accepted } };
  if (!getAcceptedTrajectory(selected, robot, field)) throw new Error("The optimization no longer matches this path or failed validation. Run Optimize again.");
  return accepted;
}
