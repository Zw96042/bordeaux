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

  const comAccelerationX = point.tangentX * accelerationMps2
    + point.curvatureInvM * point.normalX * velocityMps ** 2;
  const comAccelerationY = point.tangentY * accelerationMps2
    + point.curvatureInvM * point.normalY * velocityMps ** 2;
  const translationForceX = massKg * comAccelerationX / moduleCount;
  const translationForceY = massKg * comAccelerationY / moduleCount;
  const yawForceScale = moiKgM2 * angularAccelerationRadps2 / radiusSquaredSum;
  const tractionForceLimitN = hardLimits.tractionAccelMps2 * massKg / moduleCount;
  const stallForceLimitN = hardLimits.motorAccelMps2 * massKg / moduleCount;
  const rotatedOffsets = offsets.map((module) => {
    const offsetX = cosHeading * module.x - sinHeading * module.y;
    const offsetY = sinHeading * module.x + cosHeading * module.y;
    const perpendicularX = -offsetY;
    const perpendicularY = offsetX;
    return { ...module, offsetX, offsetY, perpendicularX, perpendicularY };
  });
  const forces = rotatedOffsets.map((module) => ({
    x: translationForceX + yawForceScale * module.perpendicularX,
    y: translationForceY + yawForceScale * module.perpendicularY,
  }));
  const forceLimitN = Math.min(tractionForceLimitN, stallForceLimitN);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    forces.forEach((force) => {
      const magnitude = Math.hypot(force.x, force.y);
      if (magnitude > forceLimitN && magnitude > EPSILON) {
        const scale = forceLimitN / magnitude;
        force.x *= scale;
        force.y *= scale;
      }
    });
    const achievedForceX = forces.reduce((sum, force) => sum + force.x, 0);
    const achievedForceY = forces.reduce((sum, force) => sum + force.y, 0);
    const achievedTorque = forces.reduce((sum, force, index) => (
      sum + rotatedOffsets[index].offsetX * force.y - rotatedOffsets[index].offsetY * force.x
    ), 0);
    const forceCorrectionX = (massKg * comAccelerationX - achievedForceX) / moduleCount;
    const forceCorrectionY = (massKg * comAccelerationY - achievedForceY) / moduleCount;
    const torqueCorrectionScale = (moiKgM2 * angularAccelerationRadps2 - achievedTorque) / radiusSquaredSum;
    rotatedOffsets.forEach((module, index) => {
      forces[index].x += forceCorrectionX + torqueCorrectionScale * module.perpendicularX;
      forces[index].y += forceCorrectionY + torqueCorrectionScale * module.perpendicularY;
    });
  }

  return rotatedOffsets.map((module, index) => {
    const requiredForceN = Math.hypot(forces[index].x, forces[index].y);
    return {
      label: module.label,
      requiredForceN,
      requiredMotorForceN: requiredForceN,
      tractionForceLimitN,
      // Match Choreo's force-contact model: wheel speed and maximum wheel
      // torque are independent constraints. Applying a DC torque-speed line
      // to the entire allocated force vector double-counts the wheel-speed
      // constraint and produces severe false slowdowns during combined motion.
      motorForceLimitN: stallForceLimitN,
    };
  });
}

export function buildDrivetrainProjection(
  state: CanonicalPathState,
  robot: RobotConfig,
  intervalAccelerationLimits: readonly number[],
  translationPriorityIntervals: readonly boolean[] = [],
  forceSafety = 1,
): DrivetrainProjection {
  if (intervalAccelerationLimits.length !== state.points.length - 1) {
    throw new Error("Drivetrain interval limits must be one less than the path point count.");
  }
  const withoutHeadingDynamics = (point: CanonicalPathPoint): CanonicalPathPoint => ({
    ...point,
    headingDerivativeRadPerM: 0,
    headingSecondDerivativeRadPerM2: 0,
  });
  const pointVelocityLimits = state.points.map((point, index) => {
    const limit = Math.min(
      intervalAccelerationLimits[index - 1] ?? Number.POSITIVE_INFINITY,
      intervalAccelerationLimits[index] ?? Number.POSITIVE_INFINITY,
    );
    const projectedPoint = translationPriorityIntervals[index - 1] || translationPriorityIntervals[index]
      ? withoutHeadingDynamics(point)
      : point;
    return projectDrivetrainAtPoint(projectedPoint, robot, limit).velocityLimitMps;
  });
  const intervalProjections = state.points.slice(1).map((point, index) => {
    const midpoint = interpolatePathPoint(state.points[index], point);
    const projectedMidpoint = translationPriorityIntervals[index]
      ? withoutHeadingDynamics(midpoint)
      : midpoint;
    return projectDrivetrainAtPoint(projectedMidpoint, robot, intervalAccelerationLimits[index], forceSafety);
  });
  return {
    pointVelocityLimits,
    intervalVelocityLimits: intervalProjections.map((projection) => projection.velocityLimitMps),
    intervalAccelerationConstraints: intervalProjections.map((projection) => projection.accelerationConstraints),
    intervalScalarAccelerationConstraints: intervalProjections.map((projection) => projection.scalarAccelerationConstraints),
  };
}
