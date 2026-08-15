import type { PlannerInput, TrajectorySample } from "../types";
import { activeRanges, effectiveRanges, type EffectiveRange } from "./rotationPriority";
import { buildLinearConstraintProfile } from "./optimizationConstraints";
import { buildCanonicalPathState, findDynamicHeadingStops, interpolatePathPoint } from "./pathState";
import {
  buildDrivetrainProjection,
  evaluateDrivetrainKinematics,
  projectDrivetrainAtPoint,
} from "./drivetrainProjection";
import { accelerationBoundsForSpeedSquared } from "./reachability";

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

export type TrajectoryViolationKind =
  | "boundary-velocity"
  | "linear-velocity"
  | "linear-acceleration"
  | "linear-deceleration"
  | "centripetal-acceleration"
  | "angular-velocity"
  | "angular-acceleration"
  | "drivetrain-velocity"
  | "drivetrain-acceleration";

export interface TrajectoryConstraintViolation {
  kind: TrajectoryViolationKind;
  sampleIndex: number;
  measured: number;
  limit: number;
  message: string;
  refinable: boolean;
}

export interface TrajectoryValidationResult {
  violations: TrajectoryConstraintViolation[];
  refinableIntervals: number[];
  activeConstraints: string[];
  checkedPoints: number;
  angularValidationSkipped: boolean;
}

export interface TrajectoryValidationOptions {
  skipAngular?: boolean;
  skipAngularFromIndex?: number;
  angularKinematics?: "path" | "sample";
}

function tolerance(limit: number, absolute = 1e-3, relative = 2e-3): number {
  return Math.max(absolute, Math.abs(limit) * relative);
}

function angularLimitsAt(input: PlannerInput, ranges: readonly EffectiveRange[], fraction: number) {
  return angularLimitsForRanges(input, activeRanges(ranges, fraction));
}

function angularLimitsForRanges(input: PlannerInput, ranges: readonly EffectiveRange[]) {
  let velocity = input.path.constraints.maxAngVel * DEG;
  let acceleration = input.path.constraints.maxAngAccel * DEG;
  let deceleration = (input.path.constraints.maxAngDecel ?? input.path.constraints.maxAngAccel) * DEG;
  for (const range of ranges) {
    velocity = Math.min(velocity, range.maxAngVel * DEG);
    acceleration = Math.min(acceleration, range.maxAngAccel * DEG);
    deceleration = Math.min(deceleration, range.maxAngAccel * DEG);
  }
  return { velocity, acceleration, deceleration };
}

function angularLimitsForInterval(
  input: PlannerInput,
  ranges: readonly EffectiveRange[],
  before: number,
  after: number,
) {
  const start = Math.min(before, after);
  const end = Math.max(before, after);
  return angularLimitsForRanges(input, ranges.filter((range) => (
    Math.min(end, range.end) - Math.max(start, range.start) > EPSILON
  )));
}

function pushViolation(
  violations: TrajectoryConstraintViolation[],
  kind: TrajectoryViolationKind,
  sampleIndex: number,
  measured: number,
  limit: number,
  refinable: boolean,
  label: string,
): void {
  violations.push({
    kind,
    sampleIndex,
    measured,
    limit,
    refinable,
    message: `${label} is ${measured.toFixed(4)}; limit is ${limit.toFixed(4)} at sample ${sampleIndex}.`,
  });
}

export function validateOptimizedTrajectory(
  input: PlannerInput,
  samples: readonly TrajectorySample[],
  options: TrajectoryValidationOptions = {},
): TrajectoryValidationResult {
  const violations: TrajectoryConstraintViolation[] = [];
  const refinableIntervals = new Set<number>();
  const activeConstraints = new Set<string>();
  if (samples.length < 2) {
    return {
      violations,
      refinableIntervals: [],
      activeConstraints: [],
      checkedPoints: samples.length,
      angularValidationSkipped: Boolean(options.skipAngular || options.skipAngularFromIndex !== undefined),
    };
  }

  const initialHeadingBreaks = options.skipAngularFromIndex === undefined
    ? new Set<number>()
    : new Set([options.skipAngularFromIndex]);
  const preliminaryState = buildCanonicalPathState(
    input.path,
    samples,
    initialHeadingBreaks,
  );
  const dynamicHeadingStops = findDynamicHeadingStops(preliminaryState, options.skipAngularFromIndex);
  const state = buildCanonicalPathState(
    input.path,
    samples,
    new Set([...initialHeadingBreaks, ...dynamicHeadingStops]),
    dynamicHeadingStops,
  );
  const linear = buildLinearConstraintProfile(input, samples);
  const lateralLimits = linear.intervals.map((limits) => (
    input.path.constraints.maxCentripetalAccel ?? limits.acceleration
  ));
  const drivetrain = buildDrivetrainProjection(state, input.robot, lateralLimits);
  const ranges = effectiveRanges(input.path, samples, state.totalDistanceM);
  const usesSampleAngularKinematics = options.angularKinematics === "sample";
  const stationaryTurnBoundary = (index: number) => {
    const point = state.points[index];
    return point?.stop
      && point.waypointIndex !== undefined
      && Boolean(input.path.waypoints[point.waypointIndex]?.turnInPlace);
  };
  const skipsAngularAt = (index: number) => Boolean(options.skipAngular)
    || (options.skipAngularFromIndex !== undefined && index >= options.skipAngularFromIndex)
    || stationaryTurnBoundary(index);
  const skipsAngularForInterval = (index: number) => skipsAngularAt(index)
    || skipsAngularAt(index + 1);

  const expectedStart = input.path.waypoints[0]?.stop
    ? 0
    : Math.min(linear.points[0].velocity, Math.max(0, input.path.startVel || 0));
  const expectedGoal = input.path.waypoints.at(-1)?.stop
    ? 0
    : Math.min(linear.points.at(-1)!.velocity, Math.max(0, input.path.goalVel || 0));
  for (const [index, expected] of [[0, expectedStart], [samples.length - 1, expectedGoal]] as const) {
    const measured = Math.abs(samples[index].velocityMps);
    if (Math.abs(measured - expected) > tolerance(expected, 2e-4, 2e-4)) {
      pushViolation(violations, "boundary-velocity", index, measured, expected, false, "Boundary velocity");
    }
  }

  samples.forEach((sample, index) => {
    const adjacentVelocity = Math.min(
      linear.intervals[index - 1]?.velocity ?? Number.POSITIVE_INFINITY,
      linear.intervals[index]?.velocity ?? Number.POSITIVE_INFINITY,
    );
    const linearVelocityLimit = Math.min(linear.points[index].velocity, adjacentVelocity);
    const drivetrainVelocityLimit = drivetrain.pointVelocityLimits[index];
    const speed = Math.abs(sample.velocityMps);
    if (speed > linearVelocityLimit + tolerance(linearVelocityLimit, 1e-4, 1e-4)) {
      pushViolation(violations, "linear-velocity", index, speed, linearVelocityLimit, false, "Linear velocity");
    }
    if (usesSampleAngularKinematics) {
      for (const module of evaluateDrivetrainKinematics(
        state.points[index],
        input.robot,
        speed,
        0,
        sample.angularVelocityRadps,
        0,
      )) {
        if (module.speedMps > input.robot.maxSpeed + tolerance(input.robot.maxSpeed)) {
          pushViolation(violations, "drivetrain-velocity", index, module.speedMps, input.robot.maxSpeed, false, module.label);
        }
        if (module.speedMps >= input.robot.maxSpeed * 0.995) activeConstraints.add(module.label);
      }
    } else if (speed > drivetrainVelocityLimit + tolerance(drivetrainVelocityLimit)) {
      pushViolation(violations, "drivetrain-velocity", index, speed, drivetrainVelocityLimit, false, "Drivetrain velocity");
    }
    if (linearVelocityLimit > EPSILON && speed >= linearVelocityLimit * 0.995) activeConstraints.add("linear-velocity");
    if (!usesSampleAngularKinematics
      && drivetrainVelocityLimit > EPSILON
      && speed >= drivetrainVelocityLimit * 0.995) activeConstraints.add("drivetrain-velocity");

    if (!skipsAngularAt(index)) {
      const angular = angularLimitsAt(input, ranges, sample.f);
      const omega = Math.abs(usesSampleAngularKinematics
        ? sample.angularVelocityRadps
        : state.points[index].headingDerivativeRadPerM * speed);
      if (omega > angular.velocity + tolerance(angular.velocity, 2e-3, 0.02)) {
        pushViolation(violations, "angular-velocity", index, omega, angular.velocity, false, "Angular velocity");
      }
      if (angular.velocity > EPSILON && omega >= angular.velocity * 0.995) activeConstraints.add("angular-velocity");
    }
  });

  for (let index = 0; index < samples.length - 1; index += 1) {
    const before = samples[index];
    const after = samples[index + 1];
    const distance = after.s - before.s;
    if (distance <= EPSILON) continue;
    const interval = linear.intervals[index];
    const beforeSquared = before.velocityMps ** 2;
    const afterSquared = after.velocityMps ** 2;
    const speedSquared = (beforeSquared + afterSquared) * 0.5;
    const speed = Math.sqrt(Math.max(0, speedSquared));
    const acceleration = (afterSquared - beforeSquared) / (2 * distance);
    const motorLimit = Math.min(
      interval.acceleration,
      interval.motorAcceleration * Math.max(0, Math.min(
        1,
        1 - Math.max(Math.abs(before.velocityMps), Math.abs(after.velocityMps)) / interval.freeSpeed,
      )),
    );
    if (acceleration >= 0 && acceleration > motorLimit + tolerance(motorLimit, 2e-3, 0.01)) {
      pushViolation(violations, "linear-acceleration", index + 1, acceleration, motorLimit, true, "Linear acceleration");
      refinableIntervals.add(index);
    } else if (acceleration < 0 && -acceleration > interval.deceleration + tolerance(interval.deceleration, 2e-3, 0.01)) {
      pushViolation(violations, "linear-deceleration", index + 1, -acceleration, interval.deceleration, true, "Linear deceleration");
      refinableIntervals.add(index);
    }
    if (acceleration >= 0 && motorLimit > EPSILON && acceleration >= motorLimit * 0.995) activeConstraints.add("linear-acceleration");
    if (acceleration < 0 && interval.deceleration > EPSILON && -acceleration >= interval.deceleration * 0.995) activeConstraints.add("linear-deceleration");

    const midpoint = interpolatePathPoint(state.points[index], state.points[index + 1]);
    const lateralLimit = input.path.constraints.maxCentripetalAccel ?? interval.acceleration;
    const centripetalAcceleration = speedSquared * Math.abs(midpoint.curvatureInvM);
    if (centripetalAcceleration > lateralLimit + tolerance(lateralLimit)) {
      pushViolation(violations, "centripetal-acceleration", index + 1, centripetalAcceleration, lateralLimit, true, "Centripetal acceleration");
      refinableIntervals.add(index);
    }
    if (lateralLimit > EPSILON && centripetalAcceleration >= lateralLimit * 0.995) {
      activeConstraints.add("centripetal-acceleration");
    }
    const midpointProjection = projectDrivetrainAtPoint(midpoint, input.robot, lateralLimit);
    if (usesSampleAngularKinematics) {
      const dt = after.t - before.t;
      const angularVelocity = (before.angularVelocityRadps + after.angularVelocityRadps) * 0.5;
      const angularAcceleration = dt > EPSILON
        ? (after.angularVelocityRadps - before.angularVelocityRadps) / dt
        : 0;
      for (const module of evaluateDrivetrainKinematics(
        midpoint,
        input.robot,
        speed,
        acceleration,
        angularVelocity,
        angularAcceleration,
      )) {
        const moduleAccelerationLimit = lateralLimit;
        if (module.speedMps > input.robot.maxSpeed + tolerance(input.robot.maxSpeed)) {
          pushViolation(violations, "drivetrain-velocity", index + 1, module.speedMps, input.robot.maxSpeed, true, module.label);
          refinableIntervals.add(index);
        }
        if (module.accelerationMps2 > moduleAccelerationLimit + tolerance(moduleAccelerationLimit)) {
          pushViolation(violations, "drivetrain-acceleration", index + 1, module.accelerationMps2, moduleAccelerationLimit, true, module.label);
          refinableIntervals.add(index);
        }
        const motorAccelerationLimit = module.motorAccelerationLimitMps2 ?? Number.POSITIVE_INFINITY;
        const longitudinalAcceleration = Math.abs(module.longitudinalAccelerationMps2);
        if (longitudinalAcceleration > motorAccelerationLimit + tolerance(motorAccelerationLimit)) {
          pushViolation(violations, "drivetrain-acceleration", index + 1, longitudinalAcceleration, motorAccelerationLimit, true, `${module.label} motor`);
          refinableIntervals.add(index);
        }
        if (module.speedMps >= input.robot.maxSpeed * 0.995
          || module.accelerationMps2 >= moduleAccelerationLimit * 0.94
          || longitudinalAcceleration >= motorAccelerationLimit * 0.94) activeConstraints.add(module.label);
      }
    } else {
      const midpointVelocityLimit = Math.min(interval.velocity, midpointProjection.velocityLimitMps);
      if (speed > midpointVelocityLimit + tolerance(midpointVelocityLimit)) {
        pushViolation(violations, "drivetrain-velocity", index + 1, speed, midpointVelocityLimit, true, "Midpoint drivetrain velocity");
        refinableIntervals.add(index);
      }
      for (const constraint of midpointProjection.velocityConstraints) {
        const measured = constraint.coefficient * speed;
        if (constraint.limitMps > EPSILON && measured >= constraint.limitMps * 0.995) {
          activeConstraints.add(constraint.label);
        }
      }

      const bounds = accelerationBoundsForSpeedSquared(midpointProjection.accelerationConstraints, speedSquared);
      if (!bounds || acceleration < bounds.minimum - tolerance(Math.abs(bounds?.minimum ?? 0))
        || acceleration > bounds.maximum + tolerance(Math.abs(bounds?.maximum ?? 0))) {
        const limit = bounds
          ? Math.max(Math.abs(bounds.minimum), Math.abs(bounds.maximum))
          : 0;
        pushViolation(violations, "drivetrain-acceleration", index + 1, Math.abs(acceleration), limit, true, "Drivetrain acceleration");
        refinableIntervals.add(index);
      } else {
        for (const constraint of midpointProjection.accelerationConstraints) {
          const measured = Math.hypot(
            constraint.uX * acceleration + constraint.xX * speedSquared,
            constraint.uY * acceleration + constraint.xY * speedSquared,
          );
          if (constraint.label && measured >= constraint.limit * 0.94) activeConstraints.add(constraint.label);
        }
      }
      for (const constraint of midpointProjection.motorAccelerationConstraints) {
        const moduleSpeed = constraint.velocityCoefficient! * speed;
        const motorLimit = constraint.motorAcceleration!
          * Math.max(0, 1 - moduleSpeed / constraint.freeSpeed!);
        const measured = Math.abs(constraint.u * acceleration + constraint.x * speedSquared);
        if (measured > motorLimit + tolerance(motorLimit)) {
          pushViolation(violations, "drivetrain-acceleration", index + 1, measured, motorLimit, true, `${constraint.label} motor`);
          refinableIntervals.add(index);
        }
        if (constraint.label && measured >= motorLimit * 0.94) activeConstraints.add(constraint.label);
      }
    }

    if (!skipsAngularForInterval(index)) {
      const angular = angularLimitsForInterval(input, ranges, before.f, after.f);
      const midpointOmega = usesSampleAngularKinematics
        ? (before.angularVelocityRadps + after.angularVelocityRadps) * 0.5
        : midpoint.headingDerivativeRadPerM * speed;
      const omega = Math.abs(midpointOmega);
      if (omega > angular.velocity + tolerance(angular.velocity, 2e-3, 0.02)) {
        pushViolation(violations, "angular-velocity", index + 1, omega, angular.velocity, false, "Angular velocity");
      }
      const dt = after.t - before.t;
      const signedAngularAcceleration = usesSampleAngularKinematics
        ? (dt > EPSILON ? (after.angularVelocityRadps - before.angularVelocityRadps) / dt : 0)
        : midpoint.headingDerivativeRadPerM * acceleration
          + midpoint.headingSecondDerivativeRadPerM2 * speedSquared;
      const headingDirection = Math.sign(midpoint.headingDerivativeRadPerM);
      const angularMagnitudeAcceleration = headingDirection === 0
        ? Math.abs(signedAngularAcceleration)
        : headingDirection * signedAngularAcceleration;
      const reversing = usesSampleAngularKinematics
        && Math.sign(after.angularVelocityRadps) !== 0
        && Math.sign(before.angularVelocityRadps) !== 0
        && Math.sign(after.angularVelocityRadps) !== Math.sign(before.angularVelocityRadps);
      const angularAccelerationLimit = usesSampleAngularKinematics
        ? reversing
          ? Math.min(angular.acceleration, angular.deceleration)
          : Math.abs(after.angularVelocityRadps) >= Math.abs(before.angularVelocityRadps)
            ? angular.acceleration
            : angular.deceleration
        : angularMagnitudeAcceleration >= 0
          ? angular.acceleration
          : angular.deceleration;
      const angularAcceleration = Math.abs(signedAngularAcceleration);
      if (angularAcceleration > angularAccelerationLimit + tolerance(angularAccelerationLimit, 2e-3, 0.02)) {
        pushViolation(violations, "angular-acceleration", index + 1, angularAcceleration, angularAccelerationLimit, true, "Angular acceleration");
        refinableIntervals.add(index);
      }
      if (angularAccelerationLimit > EPSILON && angularAcceleration >= angularAccelerationLimit * 0.995) {
        activeConstraints.add("angular-acceleration");
      }
    }
  }

  return {
    violations,
    refinableIntervals: [...refinableIntervals].sort((left, right) => left - right),
    activeConstraints: [...activeConstraints].sort(),
    checkedPoints: samples.length * 2 - 1,
    angularValidationSkipped: Boolean(options.skipAngular || options.skipAngularFromIndex !== undefined),
  };
}
