import { describe, expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import type { RobotConfig, TrajectoryPlannerId } from "../src/shared/types";

type ModelPatch = Partial<NonNullable<RobotConfig["driveModel"]>>;

function run(plannerId: TrajectoryPlannerId, patch: ModelPatch): number {
  const project = createDemoProject();
  project.robot.driveModel = {
    motorId: "ctre-kraken-x60",
    motorFreeRpm: 6000,
    motorMaxTorqueNm: 7.09,
    motorCount: 4,
    gearRatio: 6.75,
    wheelDiameterM: 0.1016,
    massKg: 54,
    moiKgM2: 6.35,
    wheelbaseM: 0.66,
    trackwidthM: 0.66,
    wheelFrictionCoefficient: 1.4,
    ...patch,
  };
  const path = project.paths[0];
  path.headingMode = "tangent";
  path.waypoints = buildWaypoints([{ x: 1, y: 4, stop: true }, { x: 16, y: 4, stop: true }]);
  path.constraints = {
    ...path.constraints,
    maxVel: 10,
    maxAccel: 30,
    maxDecel: 30,
    maxCentripetalAccel: 30,
  };
  return getPlanner(plannerId).generate({ path, robot: project.robot }).totalTimeS;
}

function runHeadingChange(plannerId: TrajectoryPlannerId, moiKgM2: number): number {
  const project = createDemoProject();
  project.robot.driveModel = {
    motorId: "ctre-kraken-x60",
    motorFreeRpm: 6000,
    motorMaxTorqueNm: 7.09,
    motorStallCurrentA: 366,
    motorCurrentLimitA: 60,
    motorCount: 4,
    gearRatio: 6.75,
    wheelDiameterM: 0.1016,
    massKg: 54,
    moiKgM2,
    wheelbaseM: 0.66,
    trackwidthM: 0.66,
    wheelFrictionCoefficient: 1.4,
    batteryNominalVoltage: 12,
    batteryInternalResistanceOhm: 0.02,
  };
  const path = project.paths[0];
  path.headingMode = "manual";
  path.waypoints = buildWaypoints([
    { x: 1, y: 4, theta: 0, thetaOn: true, stop: true, segType: "line" },
    { x: 4, y: 4, theta: 180, thetaOn: true, stop: true, segType: "line" },
  ]);
  return getPlanner(plannerId).generate({ path, robot: project.robot }).totalTimeS;
}

describe("drivetrain model experiment", () => {
  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "%s responds monotonically to current, sag, traction, and mass",
    (plannerId) => {
      const scenarios = {
        legacy: run(plannerId, {}),
        idealElectrical: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 366,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.000001,
        }),
        currentLimited: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.000001,
        }),
        nominalSag: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
        }),
        weakBattery: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.035,
        }),
        lowVoltage: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 10.5,
          batteryInternalResistanceOhm: 0.02,
        }),
        twoMotors: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          motorCount: 2,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
        }),
        lowTraction: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
          wheelFrictionCoefficient: 0.8,
        }),
        heavyRobot: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
          massKg: 68,
        }),
        fasterGearing: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
          gearRatio: 5.5,
        }),
        torqueGearing: run(plannerId, {
          motorStallCurrentA: 366,
          motorCurrentLimitA: 60,
          batteryNominalVoltage: 12,
          batteryInternalResistanceOhm: 0.02,
          gearRatio: 8.5,
        }),
      };

      console.info(`DRIVETRAIN_MODEL_EXPERIMENT ${plannerId} ${JSON.stringify(scenarios)}`);
      expect(scenarios.currentLimited).toBeGreaterThan(scenarios.idealElectrical);
      expect(scenarios.nominalSag).toBeGreaterThan(scenarios.currentLimited);
      expect(scenarios.weakBattery).toBeGreaterThan(scenarios.nominalSag);
      expect(scenarios.lowVoltage).toBeGreaterThan(scenarios.nominalSag);
      expect(scenarios.twoMotors).toBeGreaterThan(scenarios.nominalSag);
      expect(scenarios.lowTraction).toBeGreaterThan(scenarios.nominalSag);
      expect(scenarios.heavyRobot).toBeGreaterThan(scenarios.nominalSag);
    },
  );

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "%s slows a large heading change as moment of inertia increases",
    (plannerId) => {
      const nominal = runHeadingChange(plannerId, 6.35);
      const highInertia = runHeadingChange(plannerId, 40);

      console.info(`DRIVETRAIN_ROTATION_EXPERIMENT ${plannerId} ${JSON.stringify({ nominal, highInertia })}`);
      expect(highInertia).toBeGreaterThan(nominal);
    },
  );
});
