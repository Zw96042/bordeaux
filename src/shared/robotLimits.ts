import type { PathConstraints, RobotConfig } from "./types";

const GRAVITY_MPS2 = 9.80665;
const RADIANS_TO_DEGREES = 180 / Math.PI;
// Published FRC motor free-speed, stall-current, and stall-torque values are specified at 12 V.
const MOTOR_SPEC_VOLTAGE = 12;

export interface RobotHardLimits {
  maxSpeedMps: number;
  maxAccelMps2: number;
  maxCornerAccelMps2: number;
  maxAngularSpeedDegps: number;
  maxAngularAccelDegps2: number;
  motorAccelMps2: number;
  stallMotorAccelMps2: number;
  tractionAccelMps2: number;
  currentLimitRatio: number;
  sagCoefficient: number;
  motorVoltageRatio: number;
}

type MotorAccelerationCurve = readonly [
  freeSpeedMps: number,
  constantAccelerationMps2: number,
  voltageAccelerationMps2: number,
];

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
  const ratedMaxSpeedMps = model.motorFreeRpm / 60 * Math.PI * model.wheelDiameterM / model.gearRatio;
  const motorAccelMps2 = model.motorCount! * model.motorMaxTorqueNm! * model.gearRatio
    / (wheelRadiusM * model.massKg!);
  const tractionAccelMps2 = model.wheelFrictionCoefficient! * GRAVITY_MPS2;
  const electricalValues = [
    model.motorStallCurrentA,
    model.motorCurrentLimitA,
    model.batteryNominalVoltage,
    model.batteryInternalResistanceOhm,
  ];
  const electricalModel = electricalValues.every((value) => Number.isFinite(value) && value! > 0);
  const currentLimitRatio = electricalModel
    ? model.motorCurrentLimitA! / model.motorStallCurrentA!
    : 1;
  const motorVoltageRatio = electricalModel
    ? model.batteryNominalVoltage! / MOTOR_SPEC_VOLTAGE
    : 1;
  const maxSpeedMps = ratedMaxSpeedMps * motorVoltageRatio;
  const sagCoefficient = electricalModel
    ? model.motorCount! * model.motorStallCurrentA! * model.batteryInternalResistanceOhm!
      / MOTOR_SPEC_VOLTAGE
    : 0;
  const zeroSpeedTorqueRatio = electricalModel
    ? Math.min(currentLimitRatio, motorVoltageRatio / (1 + sagCoefficient))
    : 1;
  const availableMotorAccelMps2 = motorAccelMps2 * zeroSpeedTorqueRatio;
  const maxAccelMps2 = Math.min(availableMotorAccelMps2, tractionAccelMps2);
  const moduleRadiusM = robot.drive === "tank"
    ? model.trackwidthM! / 2
    : Math.hypot(model.wheelbaseM! / 2, model.trackwidthM! / 2);
  const maxAngularSpeedDegps = maxSpeedMps / moduleRadiusM * RADIANS_TO_DEGREES;
  const maxAngularAccelDegps2 = maxAccelMps2 * model.massKg! * moduleRadiusM
    / model.moiKgM2! * RADIANS_TO_DEGREES;
  const positiveDerived = [
    maxSpeedMps,
    maxAccelMps2,
    tractionAccelMps2,
    maxAngularSpeedDegps,
    maxAngularAccelDegps2,
    availableMotorAccelMps2,
    motorAccelMps2,
    currentLimitRatio,
    motorVoltageRatio,
  ];
  if (!positiveDerived.every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(sagCoefficient) || sagCoefficient < 0) return null;
  return {
    maxSpeedMps,
    maxAccelMps2,
    maxCornerAccelMps2: tractionAccelMps2,
    maxAngularSpeedDegps,
    maxAngularAccelDegps2,
    motorAccelMps2: availableMotorAccelMps2,
    stallMotorAccelMps2: motorAccelMps2,
    tractionAccelMps2,
    currentLimitRatio,
    sagCoefficient,
    motorVoltageRatio,
  };
}

function motorAccelerationCurve(robot: RobotConfig, authoredLimitMps2: number): MotorAccelerationCurve {
  const limits = robotHardLimits(robot);
  const effectiveAuthoredLimit = Number.isFinite(authoredLimitMps2)
    ? Math.max(0, authoredLimitMps2)
    : limits?.maxAccelMps2 ?? authoredLimitMps2;
  const freeSpeedMps = limits?.maxSpeedMps ?? Math.max(1e-9, robot.maxSpeed);
  if (!limits || limits.sagCoefficient === 0) {
    return [freeSpeedMps, effectiveAuthoredLimit, effectiveAuthoredLimit];
  }
  return [
    freeSpeedMps,
    Math.min(
      effectiveAuthoredLimit,
      limits.tractionAccelMps2,
      limits.stallMotorAccelMps2 * limits.currentLimitRatio,
    ),
    limits.stallMotorAccelMps2
      * limits.motorVoltageRatio / (1 + limits.sagCoefficient),
  ];
}

/** Maximum forward acceleration at a chassis speed under torque-speed, current, sag, and traction limits. */
export function motorAccelerationAtSpeed(
  robot: RobotConfig,
  velocityMps: number,
  authoredLimitMps2 = Infinity,
): number {
  const [freeSpeed, constantAcceleration, voltageAcceleration] = motorAccelerationCurve(robot, authoredLimitMps2);
  const speedRatio = Math.max(0, Math.min(1, Math.abs(velocityMps) / freeSpeed));
  const voltageLimited = speedRatio >= 1
    ? 0
    : voltageAcceleration * (1 - speedRatio);
  return Math.min(constantAcceleration, voltageLimited);
}

/** Integrates the piecewise constant/linear motor curve over a distance interval. */
export function motorLimitedVelocityAfterDistance(
  robot: RobotConfig,
  initialVelocityMps: number,
  distanceM: number,
  authoredLimitMps2 = Infinity,
): number {
  const [freeSpeed, constantAcceleration, voltageAcceleration] = motorAccelerationCurve(robot, authoredLimitMps2);
  const initialVelocity = Math.max(0, Math.min(freeSpeed, Math.abs(initialVelocityMps)));
  if (distanceM <= 0 || initialVelocity >= freeSpeed) return initialVelocity;
  if (constantAcceleration <= 0 || voltageAcceleration <= 0) return initialVelocity;
  if (!Number.isFinite(constantAcceleration) || !Number.isFinite(voltageAcceleration)) return freeSpeed;

  const transitionVelocity = constantAcceleration < voltageAcceleration
    ? freeSpeed * (1 - constantAcceleration / voltageAcceleration)
    : 0;
  let remainingDistance = distanceM;
  let linearStart = initialVelocity;
  if (initialVelocity < transitionVelocity) {
    const distanceToTransition = (transitionVelocity ** 2 - initialVelocity ** 2)
      / (2 * constantAcceleration);
    if (remainingDistance <= distanceToTransition) {
      return Math.sqrt(initialVelocity ** 2 + 2 * constantAcceleration * remainingDistance);
    }
    remainingDistance -= distanceToTransition;
    linearStart = transitionVelocity;
  }

  // For a(v) = A(1 - v / V), distance is the integral of v / a(v) dv.
  const distanceTo = (velocity: number) => freeSpeed / voltageAcceleration * (
    freeSpeed * Math.log((freeSpeed - linearStart) / (freeSpeed - velocity))
    - (velocity - linearStart)
  );
  let low = linearStart;
  let high = freeSpeed;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = low + (high - low) / 2;
    if (distanceTo(middle) <= remainingDistance) low = middle;
    else high = middle;
  }
  return low;
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
