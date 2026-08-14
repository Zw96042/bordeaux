import { describe, expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import {
  effectivePathConstraints,
  motorAccelerationAtSpeed,
  motorLimitedVelocityAfterDistance,
  robotHardLimits,
} from "../src/shared/robotLimits";

function physicalRobot() {
  const project = createDemoProject();
  project.robot.driveModel = {
    motorId: "test",
    motorFreeRpm: 6000,
    motorMaxTorqueNm: 1,
    motorCount: 4,
    gearRatio: 10,
    wheelDiameterM: 0.1,
    massKg: 40,
    moiKgM2: 10,
    wheelbaseM: 0.6,
    trackwidthM: 0.8,
    wheelFrictionCoefficient: 0.5,
  };
  return project;
}

describe("robot hard limits", () => {
  it("derives speed, traction, motor, and angular limits", () => {
    const project = physicalRobot();
    const limits = robotHardLimits(project.robot)!;

    expect(limits.maxSpeedMps).toBeCloseTo(Math.PI, 9);
    expect(limits.motorAccelMps2).toBeCloseTo(20, 9);
    expect(limits.tractionAccelMps2).toBeCloseTo(4.903325, 9);
    expect(limits.maxAccelMps2).toBeCloseTo(4.903325, 9);
    expect(limits.maxAngularSpeedDegps).toBeCloseTo(360, 9);
    expect(limits.maxAngularAccelDegps2).toBeCloseTo(9.80665 * 180 / Math.PI, 9);
  });

  it("uses the robot envelope globally and lets ranges only tighten it", () => {
    const project = physicalRobot();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([{ x: 1, y: 1 }, { x: 7, y: 1 }]);
    path.constraints = { maxVel: 0.1, maxAccel: 0.1, maxDecel: 0.1, maxAngVel: 1, maxAngAccel: 1 };

    const planner = getPlanner("profiledSpline");
    const unrestricted = planner.generate({ path, robot: project.robot });
    expect(Math.max(...unrestricted.samples.map((sample) => sample.velocityMps))).toBeGreaterThan(1);

    const limits = effectivePathConstraints(path.constraints, project.robot);
    path.ranges = [{ anchor: "param", f0: 0, f1: 1, maxVel: 0.35, maxAccel: limits.maxAccel, maxDecel: limits.maxDecel, maxAngVel: limits.maxAngVel, maxAngAccel: limits.maxAngAccel }];
    const constrained = planner.generate({ path, robot: project.robot });
    expect(Math.max(...constrained.samples.map((sample) => sample.velocityMps))).toBeLessThanOrEqual(0.3501);
  });

  it("preserves authored limits until the physical model is complete", () => {
    const project = createDemoProject();
    expect(robotHardLimits(project.robot)).toBeNull();
    expect(effectivePathConstraints(project.paths[0].constraints, project.robot)).toBe(project.paths[0].constraints);
  });

  it("rejects finite model inputs whose derived envelope overflows", () => {
    const project = physicalRobot();
    project.robot.driveModel!.motorFreeRpm = Number.MAX_VALUE;
    project.robot.driveModel!.wheelDiameterM = Number.MAX_VALUE;

    expect(robotHardLimits(project.robot)).toBeNull();
    expect(effectivePathConstraints(project.paths[0].constraints, project.robot))
      .toBe(project.paths[0].constraints);
  });

  it("accounts for current limiting and loaded battery voltage across wheel speed", () => {
    const project = physicalRobot();
    Object.assign(project.robot.driveModel!, {
      motorStallCurrentA: 100,
      motorCurrentLimitA: 60,
      batteryNominalVoltage: 12,
      batteryInternalResistanceOhm: 0.02,
      wheelFrictionCoefficient: 3,
    });

    const limits = robotHardLimits(project.robot)!;
    expect(limits.sagCoefficient).toBeGreaterThan(0);
    expect(limits.stallMotorAccelMps2).toBeCloseTo(20, 9);
    expect(limits.sagCoefficient).toBeCloseTo(2 / 3, 9);
    expect(limits.motorAccelMps2).toBeCloseTo(12, 9);
    expect(motorAccelerationAtSpeed(project.robot, 0)).toBeCloseTo(12, 9);
    expect(motorAccelerationAtSpeed(project.robot, limits.maxSpeedMps / 2)).toBeCloseTo(6, 9);
    expect(motorAccelerationAtSpeed(project.robot, limits.maxSpeedMps)).toBe(0);
  });

  it("integrates the declining motor curve across the full distance interval", () => {
    const project = physicalRobot();
    Object.assign(project.robot.driveModel!, {
      motorStallCurrentA: 100,
      motorCurrentLimitA: 20,
      batteryNominalVoltage: 12,
      batteryInternalResistanceOhm: 1e-9,
      wheelFrictionCoefficient: 3,
    });
    const initialVelocity = 2.5355;
    const distance = 0.2678;
    const integrated = motorLimitedVelocityAfterDistance(project.robot, initialVelocity, distance, 30);
    const split = motorLimitedVelocityAfterDistance(
      project.robot,
      motorLimitedVelocityAfterDistance(project.robot, initialVelocity, distance * 0.4, 30),
      distance * 0.6,
      30,
    );
    const startAcceleration = motorAccelerationAtSpeed(project.robot, initialVelocity, 30);
    const startSampleApproximation = Math.sqrt(initialVelocity ** 2 + 2 * startAcceleration * distance);

    expect(integrated).toBeCloseTo(2.8198166, 6);
    expect(split).toBeCloseTo(integrated, 10);
    expect(integrated).toBeLessThan(startSampleApproximation - 0.05);
  });

  it.each(["profiledSpline", "optimizedTrajectory"] as const)(
    "keeps every accelerating %s interval inside the integrated motor curve",
    (plannerId) => {
      const project = physicalRobot();
      Object.assign(project.robot.driveModel!, {
        motorStallCurrentA: 100,
        motorCurrentLimitA: 20,
        batteryNominalVoltage: 12,
        batteryInternalResistanceOhm: 1e-9,
        wheelFrictionCoefficient: 3,
      });
      const path = project.paths[0];
      path.headingMode = "tangent";
      path.waypoints = buildWaypoints([
        { x: 1, y: 4, stop: true, segType: "line" },
        { x: 16, y: 4, stop: true, segType: "line" },
      ]);
      path.constraints = {
        ...path.constraints,
        maxVel: 30,
        maxAccel: 30,
        maxDecel: 30,
        maxCentripetalAccel: 30,
      };

      const result = getPlanner(plannerId).generate({ path, robot: project.robot });
      const effective = effectivePathConstraints(path.constraints, project.robot);
      let separatedFromStartSampleApproximation = false;
      for (let index = 1; index < result.samples.length; index += 1) {
        const previous = result.samples[index - 1];
        const sample = result.samples[index];
        const distance = sample.s - previous.s;
        if (distance <= 1e-9 || sample.velocityMps <= previous.velocityMps + 1e-4) continue;
        const reachable = motorLimitedVelocityAfterDistance(
          project.robot,
          previous.velocityMps,
          distance,
          effective.maxAccel,
        );
        expect(sample.velocityMps, `interval ${index - 1}-${index}`).toBeLessThanOrEqual(reachable + 0.002);
        const startAcceleration = motorAccelerationAtSpeed(project.robot, previous.velocityMps, effective.maxAccel);
        const startSampleApproximation = Math.sqrt(previous.velocityMps ** 2 + 2 * startAcceleration * distance);
        if (previous.velocityMps > 2.5 && sample.velocityMps < startSampleApproximation - 0.02) {
          separatedFromStartSampleApproximation = true;
        }
      }
      expect(separatedFromStartSampleApproximation).toBe(true);
      if (result.optimization) expect(result.optimization.constraintViolations).toBe(0);
    },
  );

  it.each([
    { voltage: 6, speedScale: 0.5, torqueScale: 0.5 },
    { voltage: 16, speedScale: 4 / 3, torqueScale: 4 / 3 },
  ])("scales the 12 V motor curve at $voltage V", ({ voltage, speedScale, torqueScale }) => {
    const project = physicalRobot();
    Object.assign(project.robot.driveModel!, {
      motorStallCurrentA: 100,
      motorCurrentLimitA: 200,
      batteryNominalVoltage: voltage,
      batteryInternalResistanceOhm: 1e-9,
      wheelFrictionCoefficient: 3,
    });

    const limits = robotHardLimits(project.robot)!;
    expect(limits.maxSpeedMps).toBeCloseTo(Math.PI * speedScale, 7);
    expect(limits.motorAccelMps2).toBeCloseTo(20 * torqueScale, 5);
    expect(motorAccelerationAtSpeed(project.robot, 0)).toBeCloseTo(20 * torqueScale, 5);
    expect(motorAccelerationAtSpeed(project.robot, limits.maxSpeedMps)).toBe(0);
  });

  it("keeps legacy physical profiles unchanged when electrical inputs are absent", () => {
    const project = physicalRobot();
    const limits = robotHardLimits(project.robot)!;

    expect(limits.sagCoefficient).toBe(0);
    expect(limits.motorAccelMps2).toBeCloseTo(20, 9);
    expect(motorAccelerationAtSpeed(project.robot, limits.maxSpeedMps / 2)).toBeCloseTo(2.4516625, 9);
  });

  it("keeps the legacy profiled-spline timing", () => {
    const project = physicalRobot();
    const path = project.paths[0];
    path.headingMode = "tangent";
    path.waypoints = buildWaypoints([{ x: 1, y: 1, stop: true }, { x: 7, y: 1, stop: true }]);
    path.constraints = {
      ...path.constraints,
      maxVel: 10,
      maxAccel: 30,
      maxDecel: 30,
      maxCentripetalAccel: 30,
    };

    const trajectory = getPlanner("profiledSpline").generate({ path, robot: project.robot });
    expect(trajectory.totalTimeS).toBeCloseTo(2.5509, 6);
  });
});
