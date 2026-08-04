import path from "node:path";
import { parseLabviewBdx } from "../export/labviewBdxReader";
import { FIELD_H, FIELD_W } from "../math/fieldBounds";
import type { BordeauxProject, SegmentType } from "../types";
import { validateProject } from "../validation";
import { buildWaypoints, DEFAULT_LABVIEW_OPTIONS } from "./defaults";
import type { DecodedProjectFile } from "./fileFormat";

const METERS_PER_FOOT = 0.3048;

function importedName(filePath: string): string {
  const extension = path.extname(filePath);
  const name = path.basename(filePath, extension).trim();
  return name || "Imported LabVIEW Path";
}

export function decodeLabviewBdxProject(input: Uint8Array, filePath = "Imported.bdx"): DecodedProjectFile {
  const decoded = parseLabviewBdx(input);
  const limits = decoded.conditions.limits;
  const angularLimits = decoded.conditions.angularLimits;
  if (limits.velocityFps <= 0 || limits.accelerationFps2 <= 0 || limits.stoopidFastFps <= 0
    || angularLimits.velocityDegPerS <= 0 || angularLimits.accelerationDegPerS2 <= 0) {
    throw new Error("LabVIEW Bordeaux velocity and acceleration limits must be greater than zero to edit");
  }
  if (limits.jerkFps3 < 0 || angularLimits.jerkDegPerS3 < 0) {
    throw new Error("LabVIEW Bordeaux jerk limits cannot be negative");
  }
  if (decoded.conditions.initialVelocityFps < 0 || decoded.conditions.finalVelocityFps < 0) {
    throw new Error("LabVIEW Bordeaux paths with negative endpoint velocities cannot be edited without changing their meaning");
  }
  const name = importedName(filePath);
  const segmentType: SegmentType = decoded.pathType === "clothoid" ? "clothoid" : "bezier";
  let waypoints = decoded.updatedWaypoints.map((waypoint, index, source) => ({
    x: waypoint.xFt * METERS_PER_FOOT,
    y: waypoint.yFt * METERS_PER_FOOT,
    theta: waypoint.thetaDeg,
    thetaOn: true,
    segType: index < source.length - 1 ? segmentType : undefined,
  }));
  if (waypoints.length < 2) {
    const positions = decoded.trajectory.flatMap((segment) => segment.positions);
    if (positions.length >= 2) {
      waypoints = [positions[0], positions[positions.length - 1]].map((point, index) => ({
        x: point.xFt * METERS_PER_FOOT,
        y: point.yFt * METERS_PER_FOOT,
        theta: point.headingDeg,
        thetaOn: true,
        segType: index === 0 ? segmentType : undefined,
      }));
    }
  }
  if (waypoints.length < 2) throw new Error("LabVIEW Bordeaux path does not contain enough waypoints or trajectory positions to edit");
  if (waypoints.some((waypoint) => waypoint.x < 0 || waypoint.x > FIELD_W || waypoint.y < 0 || waypoint.y > FIELD_H)) {
    throw new Error("LabVIEW Bordeaux path contains coordinates outside the editable FRC field; import was rejected instead of moving them");
  }

  const project: BordeauxProject = {
    schemaVersion: "1.0",
    name,
    robot: {
      drive: decoded.driveType === "nonholonomic" ? "tank" : "swerve",
      w: 0.84,
      l: 0.84,
      // v4.4 predates the dedicated Max Robot Speed field used by the newer
      // torque model. StoopidFast is the best available legacy chassis ceiling;
      // never let the fallback sit below the authored path velocity limit.
      maxSpeed: Math.max(limits.velocityFps, limits.stoopidFastFps) * METERS_PER_FOOT,
    },
    paths: [{
      id: `path_${globalThis.crypto.randomUUID()}`,
      name,
      waypoints: buildWaypoints(waypoints),
      targets: [],
      markers: [],
      ranges: [],
      constraints: {
        maxVel: limits.velocityFps * METERS_PER_FOOT,
        maxAccel: limits.accelerationFps2 * METERS_PER_FOOT,
        maxDecel: limits.accelerationFps2 * METERS_PER_FOOT,
        maxJerk: limits.jerkFps3 * METERS_PER_FOOT,
        maxAngVel: angularLimits.velocityDegPerS,
        maxAngAccel: angularLimits.accelerationDegPerS2,
        maxAngDecel: angularLimits.accelerationDegPerS2,
        maxAngJerk: angularLimits.jerkDegPerS3,
      },
      headingMode: decoded.driveType === "nonholonomic" ? "tangent" : "manual",
      driveBackward: decoded.robotBackwards,
      startVel: decoded.conditions.initialVelocityFps * METERS_PER_FOOT,
      goalVel: decoded.conditions.finalVelocityFps * METERS_PER_FOOT,
      exportable: true,
      labview: {
        ...DEFAULT_LABVIEW_OPTIONS,
        samplePeriodS: decoded.conditions.samplePeriodS,
        reversePath: decoded.reversePath,
        zeroVelocity: decoded.zeroVelocity,
        pickupBalls: decoded.pickupBalls,
        currentLimit: decoded.currentLimit,
        zeroTranslationalVelocity: decoded.zeroTranslationalVelocity,
        correctAtBeginningOfPath: decoded.correctAtBeginningOfPath,
        stoopidFastMps: limits.stoopidFastFps * METERS_PER_FOOT,
      },
    }],
    routine: { name: "Autonomous Routine", nodes: [] },
    plannerId: decoded.pathType === "clothoid" ? "labviewClothoid" : "labviewBezier",
  };

  const validation = validateProject(project);
  if (!validation.ok) {
    throw new Error(`Imported LabVIEW Bordeaux path is not editable:\n${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`);
  }
  return { project, sourceFormat: "labview-bdx-4.4", migrated: true };
}
