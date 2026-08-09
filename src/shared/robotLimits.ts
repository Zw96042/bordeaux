import type { PathConstraints, RobotConfig } from "./types";

const GRAVITY_MPS2 = 9.80665;
const RADIANS_TO_DEGREES = 180 / Math.PI;

export interface RobotHardLimits {
  maxSpeedMps: number;
  maxAccelMps2: number;
  maxCornerAccelMps2: number;
  maxAngularSpeedDegps: number;
  maxAngularAccelDegps2: number;
  motorAccelMps2: number;
  tractionAccelMps2: number;
}

export function robotHardLimits(robot: RobotConfig): RobotHardLimits | null {
  const model = robot.driveModel;
  if (!model) return null;
  const values = [
    model.motorFreeRpm,
    model.motorMaxTorqueNm,
    model.motorCount,
    model.gearRatio,
    model.wheelDiameterM,
    model.massKg,
    model.moiKgM2,
    model.wheelbaseM,
    model.trackwidthM,
    model.wheelFrictionCoefficient,
  ];
  if (!values.every((value) => Number.isFinite(value) && value! > 0)) return null;

  const wheelRadiusM = model.wheelDiameterM / 2;
  const maxSpeedMps = model.motorFreeRpm / 60 * Math.PI * model.wheelDiameterM / model.gearRatio;
  const motorAccelMps2 = model.motorCount! * model.motorMaxTorqueNm! * model.gearRatio
    / (wheelRadiusM * model.massKg!);
  const tractionAccelMps2 = model.wheelFrictionCoefficient! * GRAVITY_MPS2;
  const maxAccelMps2 = Math.min(motorAccelMps2, tractionAccelMps2);
  const moduleRadiusM = robot.drive === "tank"
    ? model.trackwidthM! / 2
    : Math.hypot(model.wheelbaseM! / 2, model.trackwidthM! / 2);
  const maxAngularSpeedDegps = maxSpeedMps / moduleRadiusM * RADIANS_TO_DEGREES;
  const maxAngularAccelDegps2 = maxAccelMps2 * model.massKg! * moduleRadiusM
    / model.moiKgM2! * RADIANS_TO_DEGREES;
  return {
    maxSpeedMps,
    maxAccelMps2,
    maxCornerAccelMps2: tractionAccelMps2,
    maxAngularSpeedDegps,
    maxAngularAccelDegps2,
    motorAccelMps2,
    tractionAccelMps2,
  };
}

export function effectivePathConstraints(constraints: PathConstraints, robot: RobotConfig): PathConstraints {
  const limits = robotHardLimits(robot);
  if (!limits) return constraints;
  return {
    ...constraints,
    maxVel: limits.maxSpeedMps,
    maxAccel: limits.maxAccelMps2,
    maxDecel: limits.maxAccelMps2,
    maxCentripetalAccel: limits.maxCornerAccelMps2,
    maxAngVel: limits.maxAngularSpeedDegps,
    maxAngAccel: limits.maxAngularAccelDegps2,
    maxAngDecel: limits.maxAngularAccelDegps2,
  };
}
