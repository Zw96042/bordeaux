import { describe, expect, it } from "vitest";
import { getPlanner } from "../src/shared/planners";
import { buildWaypoints, createDemoProject } from "../src/shared/project/defaults";
import { effectivePathConstraints, robotHardLimits } from "../src/shared/robotLimits";

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
});
