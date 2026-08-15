import type { RobotConfig } from "../types";
import { robotHardLimits } from "../robotLimits";
import type { AffineAccelerationConstraint, AffineScalarAccelerationConstraint } from "./reachability";
import { interpolatePathPoint, type CanonicalPathPoint, type CanonicalPathState } from "./pathState";

const EPSILON = 1e-9;

export interface DrivetrainVelocityConstraint {
  coefficient: number;
  limitMps: number;
  label: string;
}

export interface DrivetrainPointProjection {
  velocityLimitMps: number;
  velocityConstraints: DrivetrainVelocityConstraint[];
  accelerationConstraints: AffineAccelerationConstraint[];
  motorAccelerationConstraints: AffineScalarAccelerationConstraint[];
}

export interface DrivetrainProjection {
  pointVelocityLimits: number[];
  intervalVelocityLimits: number[];
  intervalAccelerationConstraints: AffineAccelerationConstraint[][];
  intervalMotorAccelerationConstraints: AffineScalarAccelerationConstraint[][];
}

export interface DrivetrainKinematicValue {
  label: string;
  speedMps: number;
  accelerationMps2: number;
  longitudinalAccelerationMps2: number;
  motorAccelerationLimitMps2?: number;
}

interface ModuleOffset {
  x: number;
  y: number;
  label: string;
}

function moduleOffsets(robot: RobotConfig): ModuleOffset[] {
  const wheelbase = robot.driveModel?.wheelbaseM;
  const trackwidth = robot.driveModel?.trackwidthM;
  if (!(trackwidth && trackwidth > 0)) return [];
  const halfTrack = trackwidth * 0.5;
  if (robot.drive === "tank") {
    return [
      { x: 0, y: halfTrack, label: "tank-left-wheel" },
      { x: 0, y: -halfTrack, label: "tank-right-wheel" },
    ];
  }
  if (!(wheelbase && wheelbase > 0)) return [];
  const halfWheelbase = wheelbase * 0.5;
  return [
    { x: halfWheelbase, y: halfTrack, label: "swerve-front-left-module" },
    { x: halfWheelbase, y: -halfTrack, label: "swerve-front-right-module" },
    { x: -halfWheelbase, y: halfTrack, label: "swerve-rear-left-module" },
    { x: -halfWheelbase, y: -halfTrack, label: "swerve-rear-right-module" },
  ];
}

export function projectDrivetrainAtPoint(
  point: CanonicalPathPoint,
  robot: RobotConfig,
  accelerationLimitMps2: number,
  motorSafety = 1,
): DrivetrainPointProjection {
  const freeSpeed = Math.max(0.01, robot.maxSpeed);
  const velocityConstraints: DrivetrainVelocityConstraint[] = [];
  const accelerationConstraints: AffineAccelerationConstraint[] = [];
  const motorAccelerationConstraints: AffineScalarAccelerationConstraint[] = [];
  let velocityLimitMps = freeSpeed;
  const cosHeading = Math.cos(point.headingRad);
  const sinHeading = Math.sin(point.headingRad);
  const offsets = moduleOffsets(robot);
  const hardLimits = robotHardLimits(robot);
  if (offsets.length === 0) {
    return { velocityLimitMps, velocityConstraints, accelerationConstraints, motorAccelerationConstraints };
  }

  for (const module of offsets) {
    const offsetX = cosHeading * module.x - sinHeading * module.y;
    const offsetY = sinHeading * module.x + cosHeading * module.y;
    const perpendicularX = -offsetY;
    const perpendicularY = offsetX;
    const headingDerivative = point.headingDerivativeRadPerM;
    const uX = point.tangentX + headingDerivative * perpendicularX;
    const uY = point.tangentY + headingDerivative * perpendicularY;
    const xX = point.curvatureInvM * point.normalX
      + point.headingSecondDerivativeRadPerM2 * perpendicularX
      - headingDerivative ** 2 * offsetX;
    const xY = point.curvatureInvM * point.normalY
      + point.headingSecondDerivativeRadPerM2 * perpendicularY
      - headingDerivative ** 2 * offsetY;
    const velocityCoefficient = Math.hypot(uX, uY);
    const moduleVelocityLimit = velocityCoefficient > EPSILON
      ? freeSpeed / velocityCoefficient
      : Number.POSITIVE_INFINITY;
    velocityLimitMps = Math.min(velocityLimitMps, moduleVelocityLimit);
    velocityConstraints.push({ coefficient: velocityCoefficient, limitMps: freeSpeed, label: module.label });
    accelerationConstraints.push({
      uX,
      uY,
      xX,
      xY,
      limit: Math.max(0.01, accelerationLimitMps2),
      label: module.label,
    });
    if (hardLimits && velocityCoefficient > EPSILON) {
      const motorAcceleration = hardLimits.motorAccelMps2 * motorSafety;
      motorAccelerationConstraints.push({
        u: velocityCoefficient,
        x: (uX * xX + uY * xY) / velocityCoefficient,
        minimum: -motorAcceleration,
        maximum: motorAcceleration,
        velocityCoefficient,
        freeSpeed: hardLimits.maxSpeedMps,
        motorAcceleration,
        label: module.label,
      });
    }

    const constantSpeedCoefficient = Math.hypot(xX, xY);
    if (constantSpeedCoefficient > EPSILON) {
      velocityLimitMps = Math.min(
        velocityLimitMps,
        Math.sqrt(Math.max(0, accelerationLimitMps2) / constantSpeedCoefficient),
      );
    }
  }

  return { velocityLimitMps, velocityConstraints, accelerationConstraints, motorAccelerationConstraints };
}

export function evaluateDrivetrainKinematics(
  point: CanonicalPathPoint,
  robot: RobotConfig,
  velocityMps: number,
  accelerationMps2: number,
  angularVelocityRadps: number,
  angularAccelerationRadps2: number,
): DrivetrainKinematicValue[] {
  const cosHeading = Math.cos(point.headingRad);
  const sinHeading = Math.sin(point.headingRad);
  const hardLimits = robotHardLimits(robot);
  return moduleOffsets(robot).map((module) => {
    const offsetX = cosHeading * module.x - sinHeading * module.y;
    const offsetY = sinHeading * module.x + cosHeading * module.y;
    const perpendicularX = -offsetY;
    const perpendicularY = offsetX;
    const velocityX = point.tangentX * velocityMps + angularVelocityRadps * perpendicularX;
    const velocityY = point.tangentY * velocityMps + angularVelocityRadps * perpendicularY;
    const accelerationX = point.tangentX * accelerationMps2
      + point.curvatureInvM * point.normalX * velocityMps ** 2
      + angularAccelerationRadps2 * perpendicularX
      - angularVelocityRadps ** 2 * offsetX;
    const accelerationY = point.tangentY * accelerationMps2
      + point.curvatureInvM * point.normalY * velocityMps ** 2
      + angularAccelerationRadps2 * perpendicularY
      - angularVelocityRadps ** 2 * offsetY;
    const speedMps = Math.hypot(velocityX, velocityY);
    const longitudinalAccelerationMps2 = speedMps > EPSILON
      ? (velocityX * accelerationX + velocityY * accelerationY) / speedMps
      : 0;
    return {
      label: module.label,
      speedMps,
      accelerationMps2: Math.hypot(accelerationX, accelerationY),
      longitudinalAccelerationMps2,
      ...(hardLimits ? {
        motorAccelerationLimitMps2: hardLimits.motorAccelMps2
          * Math.max(0, 1 - speedMps / hardLimits.maxSpeedMps),
      } : {}),
    };
  });
}

export function buildDrivetrainProjection(
  state: CanonicalPathState,
  robot: RobotConfig,
  intervalAccelerationLimits: readonly number[],
  motorSafety = 1,
): DrivetrainProjection {
  if (intervalAccelerationLimits.length !== state.points.length - 1) {
    throw new Error("Drivetrain interval limits must be one less than the path point count.");
  }
  const pointVelocityLimits = state.points.map((point, index) => {
    const limit = Math.min(
      intervalAccelerationLimits[index - 1] ?? Number.POSITIVE_INFINITY,
      intervalAccelerationLimits[index] ?? Number.POSITIVE_INFINITY,
    );
    return projectDrivetrainAtPoint(point, robot, limit, motorSafety).velocityLimitMps;
  });
  const intervalProjections = state.points.slice(1).map((point, index) => {
    const midpoint = interpolatePathPoint(state.points[index], point);
    return projectDrivetrainAtPoint(midpoint, robot, intervalAccelerationLimits[index], motorSafety);
  });
  return {
    pointVelocityLimits,
    intervalVelocityLimits: intervalProjections.map((projection) => projection.velocityLimitMps),
    intervalAccelerationConstraints: intervalProjections.map((projection) => projection.accelerationConstraints),
    intervalMotorAccelerationConstraints: intervalProjections.map((projection) => projection.motorAccelerationConstraints),
  };
}
