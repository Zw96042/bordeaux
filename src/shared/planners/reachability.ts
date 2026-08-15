const EPSILON = 1e-9;
const CONTROLLABLE_TOLERANCE = 1e-9;

export type ReachabilityStatus = "optimal" | "invalid-input" | "infeasible";

export interface AffineAccelerationConstraint {
  uX: number;
  uY: number;
  xX: number;
  xY: number;
  limit: number;
  label?: string;
}

export interface AffineScalarAccelerationConstraint {
  u: number;
  x: number;
  minimum: number;
  maximum: number;
  label?: string;
  velocityCoefficient?: number;
  freeSpeed?: number;
  motorAcceleration?: number;
}

export interface ReachabilityInput {
  positions: readonly number[];
  velocityLimits: readonly number[];
  accelerationLimits: readonly number[];
  decelerationLimits: readonly number[];
  freeSpeeds: readonly number[];
  motorAccelerationLimits?: readonly number[];
  accelerationConstraints?: readonly (readonly AffineAccelerationConstraint[])[];
  scalarAccelerationConstraints?: readonly (readonly AffineScalarAccelerationConstraint[])[];
  startVelocity: number;
  goalVelocity: number;
}

export interface ReachabilityResult {
  status: ReachabilityStatus;
  velocities: number[];
  iterations: number;
  reason?: string;
}

function invalid(reason: string): ReachabilityResult {
  return { status: "invalid-input", velocities: [], iterations: 0, reason };
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function accelerationBoundsForSpeedSquared(
  constraints: readonly AffineAccelerationConstraint[],
  speedSquared: number,
  scalarConstraints: readonly AffineScalarAccelerationConstraint[] = [],
  envelopeSpeedSquared = speedSquared,
): { minimum: number; maximum: number } | null {
  let minimum = Number.NEGATIVE_INFINITY;
  let maximum = Number.POSITIVE_INFINITY;
  for (const constraint of constraints) {
    const a = constraint.uX ** 2 + constraint.uY ** 2;
    const b = 2 * speedSquared * (constraint.uX * constraint.xX + constraint.uY * constraint.xY);
    const c = speedSquared ** 2 * (constraint.xX ** 2 + constraint.xY ** 2) - constraint.limit ** 2;
    if (a <= EPSILON) {
      if (c > EPSILON) return null;
      continue;
    }
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant < -EPSILON) return null;
    const root = Math.sqrt(Math.max(0, discriminant));
    minimum = Math.max(minimum, (-b - root) / (2 * a));
    maximum = Math.min(maximum, (-b + root) / (2 * a));
    if (minimum > maximum + EPSILON) return null;
  }
  for (const constraint of scalarConstraints) {
    const offset = constraint.x * speedSquared;
    const moduleSpeed = (constraint.velocityCoefficient ?? 0) * Math.sqrt(Math.max(0, envelopeSpeedSquared));
    const motorLimit = constraint.freeSpeed && constraint.motorAcceleration
      ? constraint.motorAcceleration * Math.max(0, 1 - moduleSpeed / constraint.freeSpeed)
      : Number.POSITIVE_INFINITY;
    const constraintMinimum = Math.max(constraint.minimum, -motorLimit);
    const constraintMaximum = Math.min(constraint.maximum, motorLimit);
    if (Math.abs(constraint.u) <= EPSILON) {
      if (offset < constraintMinimum - EPSILON || offset > constraintMaximum + EPSILON) return null;
      continue;
    }
    const first = (constraintMinimum - offset) / constraint.u;
    const second = (constraintMaximum - offset) / constraint.u;
    minimum = Math.max(minimum, Math.min(first, second));
    maximum = Math.min(maximum, Math.max(first, second));
    if (minimum > maximum + EPSILON) return null;
  }
  return { minimum, maximum };
}

function accelerationBoundsForInterval(
  constraints: readonly AffineAccelerationConstraint[],
  startSpeedSquared: number,
  distance: number,
  scalarConstraints: readonly AffineScalarAccelerationConstraint[] = [],
  envelopeSpeedSquared?: number,
): { minimum: number; maximum: number } | null {
  if (distance <= EPSILON) return accelerationBoundsForSpeedSquared(constraints, startSpeedSquared, scalarConstraints);
  return accelerationBoundsForSpeedSquared(constraints.map((constraint) => ({
    ...constraint,
    // x_mid = x_start + u * ds for constant interval acceleration.
    // Substitution keeps the module equation affine in u.
    uX: constraint.uX + constraint.xX * distance,
    uY: constraint.uY + constraint.xY * distance,
  })), startSpeedSquared, scalarConstraints.map((constraint) => ({
    ...constraint,
    ...(envelopeSpeedSquared === undefined ? {
      velocityCoefficient: undefined,
      freeSpeed: undefined,
      motorAcceleration: undefined,
    } : {}),
    u: constraint.u + constraint.x * distance,
  })), envelopeSpeedSquared ?? startSpeedSquared);
}

function tightenForModuleMotorEnvelope(
  constraints: readonly AffineScalarAccelerationConstraint[],
  startSpeedSquared: number,
  distance: number,
  bounds: ControllableInterval,
): ControllableInterval | null {
  const dynamic = constraints.filter((constraint) => (
    (constraint.velocityCoefficient ?? 0) > 0
    && (constraint.freeSpeed ?? 0) > 0
    && (constraint.motorAcceleration ?? 0) > 0
  ));
  if (dynamic.length === 0) return bounds;

  const gap = (acceleration: number) => {
    const midpointSpeedSquared = Math.max(0, startSpeedSquared + acceleration * distance);
    const endSpeedSquared = Math.max(0, startSpeedSquared + 2 * acceleration * distance);
    const envelopeSpeed = Math.sqrt(Math.max(startSpeedSquared, endSpeedSquared));
    return dynamic.reduce((maximum, constraint) => {
      const moduleSpeed = constraint.velocityCoefficient! * envelopeSpeed;
      const limit = constraint.motorAcceleration!
        * Math.max(0, 1 - moduleSpeed / constraint.freeSpeed!);
      const measured = Math.abs(constraint.u * acceleration + constraint.x * midpointSpeedSquared);
      return Math.max(maximum, measured - limit);
    }, Number.NEGATIVE_INFINITY);
  };
  const tolerance = 1e-9 * Math.max(1, ...dynamic.map((constraint) => constraint.motorAcceleration!));
  const roots = (a: number, b: number, c: number): number[] => {
    if (Math.abs(a) <= EPSILON) return Math.abs(b) <= EPSILON ? [] : [-c / b];
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(Math.max(0, discriminant));
    return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  };
  const critical = [bounds.minimum, bounds.maximum, Math.max(bounds.minimum, Math.min(bounds.maximum, 0))];
  for (const constraint of dynamic) {
    const coefficient = constraint.u + constraint.x * distance;
    const offset = constraint.x * startSpeedSquared;
    const stallAtStart = constraint.motorAcceleration!
      * Math.max(0, 1 - constraint.velocityCoefficient! * Math.sqrt(startSpeedSquared) / constraint.freeSpeed!);
    if (Math.abs(coefficient) > EPSILON) {
      critical.push((-stallAtStart - offset) / coefficient, (stallAtStart - offset) / coefficient);
    }
    const quadratic = coefficient / (2 * distance);
    const constant = offset - quadratic * startSpeedSquared;
    const linear = constraint.motorAcceleration! * constraint.velocityCoefficient! / constraint.freeSpeed!;
    const freeSpeedAcceleration = (
      (constraint.freeSpeed! / constraint.velocityCoefficient!) ** 2 - startSpeedSquared
    ) / (2 * distance);
    critical.push(freeSpeedAcceleration);
    for (const velocity of [
      ...roots(quadratic, linear, constant - constraint.motorAcceleration!),
      ...roots(-quadratic, linear, -constant - constraint.motorAcceleration!),
    ]) {
      if (velocity >= 0) critical.push((velocity ** 2 - startSpeedSquared) / (2 * distance));
    }
  }
  const values = critical
    .filter((value) => Number.isFinite(value) && value >= bounds.minimum - EPSILON && value <= bounds.maximum + EPSILON)
    .map((value) => Math.max(bounds.minimum, Math.min(bounds.maximum, value)))
    .sort((left, right) => left - right)
    .filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 1e-10);
  const segments: ControllableInterval[] = [];
  const addSegment = (minimum: number, maximum: number) => {
    const previous = segments.at(-1);
    if (previous && minimum <= previous.maximum + 1e-8) previous.maximum = Math.max(previous.maximum, maximum);
    else segments.push({ minimum, maximum });
  };
  values.forEach((value, index) => {
    if (gap(value) <= tolerance) addSegment(value, value);
    const next = values[index + 1];
    if (next !== undefined && gap((value + next) * 0.5) <= tolerance) addSegment(value, next);
  });
  if (segments.length === 0) return null;
  const selected = segments.find((segment) => segment.minimum <= 0 && segment.maximum >= 0)
    ?? segments.reduce((best, segment) => (
      segment.maximum - segment.minimum > best.maximum - best.minimum ? segment : best
    ));
  const center = (selected.minimum + selected.maximum) * 0.5;
  let minimum = selected.minimum;
  if (gap(minimum) > tolerance) {
    let infeasible = minimum;
    let feasible = center;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const candidate = (infeasible + feasible) * 0.5;
      if (gap(candidate) <= tolerance) feasible = candidate;
      else infeasible = candidate;
    }
    minimum = feasible;
  }
  let maximum = selected.maximum;
  if (gap(maximum) > tolerance) {
    let feasible = center;
    let infeasible = maximum;
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const candidate = (feasible + infeasible) * 0.5;
      if (gap(candidate) <= tolerance) feasible = candidate;
      else infeasible = candidate;
    }
    maximum = feasible;
  }
  return { minimum, maximum };
}

interface ControllableInterval {
  minimum: number;
  maximum: number;
}

interface AffineBound {
  slope: number;
  intercept: number;
}

function linearControllablePredecessor(
  input: ReachabilityInput,
  index: number,
  pointLimit: number,
  next: ControllableInterval,
  distance: number,
): ControllableInterval | null {
  let minimum = 0;
  let maximum = pointLimit;
  const lower: AffineBound[] = [
    { slope: 0, intercept: -input.decelerationLimits[index] },
    { slope: -1 / (2 * distance), intercept: next.minimum / (2 * distance) },
  ];
  const upper: AffineBound[] = [
    { slope: 0, intercept: input.accelerationLimits[index] },
    { slope: -1 / (2 * distance), intercept: next.maximum / (2 * distance) },
  ];
  for (const constraint of input.scalarAccelerationConstraints?.[index] ?? []) {
    const coefficient = constraint.u + constraint.x * distance;
    if (Math.abs(coefficient) <= EPSILON) {
      if (Math.abs(constraint.x) <= EPSILON) {
        if (constraint.minimum > EPSILON || constraint.maximum < -EPSILON) return null;
      } else {
        const first = constraint.minimum / constraint.x;
        const second = constraint.maximum / constraint.x;
        minimum = Math.max(minimum, Math.min(first, second));
        maximum = Math.min(maximum, Math.max(first, second));
      }
      continue;
    }
    const slope = -constraint.x / coefficient;
    const first = constraint.minimum / coefficient;
    const second = constraint.maximum / coefficient;
    lower.push({ slope, intercept: Math.min(first, second) });
    upper.push({ slope, intercept: Math.max(first, second) });
  }
  for (const low of lower) {
    for (const high of upper) {
      const coefficient = low.slope - high.slope;
      const limit = high.intercept - low.intercept;
      if (Math.abs(coefficient) <= EPSILON) {
        if (limit < -EPSILON) return null;
      } else if (coefficient > 0) maximum = Math.min(maximum, limit / coefficient);
      else minimum = Math.max(minimum, limit / coefficient);
    }
  }
  minimum = Math.max(0, minimum);
  maximum = Math.min(pointLimit, maximum);
  return minimum <= maximum + EPSILON ? { minimum, maximum } : null;
}

function controlBoundsForInterval(
  input: ReachabilityInput,
  index: number,
  speedSquared: number,
  distance: number,
): ControllableInterval | null {
  const drivetrain = accelerationBoundsForInterval(
    input.accelerationConstraints?.[index] ?? [],
    speedSquared,
    distance,
    input.scalarAccelerationConstraints?.[index] ?? [],
  );
  if (!drivetrain) return null;
  const minimum = Math.max(-input.decelerationLimits[index], drivetrain.minimum);
  let maximum = Math.min(input.accelerationLimits[index], drivetrain.maximum);
  if (maximum > 0 && input.freeSpeeds[index] < 1e8) {
    const freeSpeed = input.freeSpeeds[index];
    const motorAcceleration = input.motorAccelerationLimits?.[index] ?? input.accelerationLimits[index];
    const coefficient = 2 * distance * motorAcceleration / freeSpeed;
    const endVelocity = Math.max(0, (
      Math.sqrt(coefficient ** 2 + 4 * (speedSquared + 2 * distance * motorAcceleration)) - coefficient
    ) * 0.5);
    const motorLimitedAcceleration = distance > EPSILON
      ? (endVelocity ** 2 - speedSquared) / (2 * distance)
      : motorAcceleration * Math.max(0, 1 - Math.sqrt(Math.max(0, speedSquared)) / freeSpeed);
    maximum = Math.min(maximum, Math.max(0, motorLimitedAcceleration));
  }
  if (minimum > maximum + EPSILON) return null;
  return tightenForModuleMotorEnvelope(
    input.scalarAccelerationConstraints?.[index] ?? [],
    speedSquared,
    distance,
    { minimum, maximum },
  );
}

function controllablePredecessor(
  input: ReachabilityInput,
  index: number,
  pointLimit: number,
  next: ControllableInterval,
): ControllableInterval | null {
  const distance = input.positions[index + 1] - input.positions[index];
  if (distance <= EPSILON) {
    const minimum = Math.max(0, next.minimum);
    const maximum = Math.min(pointLimit, next.maximum);
    return minimum <= maximum + EPSILON ? { minimum, maximum } : null;
  }

  const accelerationConstraints = input.accelerationConstraints?.[index] ?? [];
  const hasModuleMotorEnvelope = (input.scalarAccelerationConstraints?.[index] ?? []).some((constraint) => (
    constraint.velocityCoefficient !== undefined
  ));
  const freeSpeed = input.freeSpeeds[index];
  const motorAcceleration = input.motorAccelerationLimits?.[index] ?? input.accelerationLimits[index];
  const motorLimitAtPointCap = freeSpeed >= 1e8
    ? Number.POSITIVE_INFINITY
    : motorAcceleration * Math.max(0, Math.min(1, 1 - Math.sqrt(Math.max(pointLimit, next.maximum)) / freeSpeed));
  if (accelerationConstraints.length === 0
    && !hasModuleMotorEnvelope
    && motorLimitAtPointCap >= input.accelerationLimits[index] - EPSILON) {
    return linearControllablePredecessor(input, index, pointLimit, next, distance);
  }

  const transitionScale = 2 * distance;
  const controllableTolerance = CONTROLLABLE_TOLERANCE * Math.max(
    1,
    input.accelerationLimits[index],
    input.decelerationLimits[index],
    motorAcceleration,
    pointLimit / transitionScale,
    next.maximum / transitionScale,
  );
  const gap = (speedSquared: number): number => {
    const control = controlBoundsForInterval(input, index, speedSquared, distance);
    if (!control) return Number.POSITIVE_INFINITY;
    const minimum = Math.max(control.minimum, (next.minimum - speedSquared) / transitionScale);
    const maximum = Math.min(control.maximum, (next.maximum - speedSquared) / transitionScale);
    return minimum - maximum;
  };

  let left = 0;
  let right = pointLimit;
  for (let iteration = 0; iteration < 56; iteration += 1) {
    const first = (left * 2 + right) / 3;
    const second = (left + right * 2) / 3;
    if (gap(first) <= gap(second)) right = second;
    else left = first;
  }
  const candidates = [0, pointLimit, left, right, (left + right) * 0.5];
  const center = candidates.reduce((best, candidate) => gap(candidate) < gap(best) ? candidate : best, candidates[0]);
  const centerGap = gap(center);
  if (centerGap > controllableTolerance) return null;
  const boundaryTolerance = centerGap <= 0 ? 0 : controllableTolerance;

  let minimum = 0;
  if (gap(minimum) > boundaryTolerance) {
    let infeasible = minimum;
    let feasible = center;
    for (let iteration = 0; iteration < 56; iteration += 1) {
      const candidate = (infeasible + feasible) * 0.5;
      if (gap(candidate) <= boundaryTolerance) feasible = candidate;
      else infeasible = candidate;
    }
    minimum = feasible;
  }

  let maximum = pointLimit;
  if (gap(maximum) > boundaryTolerance) {
    let feasible = center;
    let infeasible = maximum;
    for (let iteration = 0; iteration < 56; iteration += 1) {
      const candidate = (feasible + infeasible) * 0.5;
      if (gap(candidate) <= boundaryTolerance) feasible = candidate;
      else infeasible = candidate;
    }
    maximum = feasible;
  }
  return { minimum: Math.max(0, minimum), maximum: Math.min(pointLimit, maximum) };
}

/**
 * Computes the fastest controllable scalar speed profile over a fixed path.
 * The backward pass finds the maximum speed that can still reach the authored
 * goal; the forward pass takes the greatest acceleration-safe speed inside
 * that controllable envelope.
 */
export function solveReachabilityProfile(input: ReachabilityInput): ReachabilityResult {
  const count = input.positions.length;
  if (count < 2) return invalid("Reachability optimization requires at least two path samples.");
  if (input.velocityLimits.length !== count) return invalid("Velocity limit count must match path sample count.");
  if (input.accelerationLimits.length !== count - 1
    || input.decelerationLimits.length !== count - 1
    || input.freeSpeeds.length !== count - 1) {
    return invalid("Interval limit counts must be one less than the path sample count.");
  }
  if (input.accelerationConstraints && input.accelerationConstraints.length !== count - 1) {
    return invalid("Acceleration constraint count must be one less than the path sample count.");
  }
  if (input.scalarAccelerationConstraints && input.scalarAccelerationConstraints.length !== count - 1) {
    return invalid("Scalar acceleration constraint count must be one less than the path sample count.");
  }
  if (input.motorAccelerationLimits && input.motorAccelerationLimits.length !== count - 1) {
    return invalid("Motor acceleration limit count must be one less than the path sample count.");
  }
  if (!isFiniteNonnegative(input.startVelocity) || !isFiniteNonnegative(input.goalVelocity)) {
    return invalid("Boundary velocities must be finite and nonnegative.");
  }

  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(input.positions[index])) return invalid(`Path position ${index} must be finite.`);
    if (index > 0 && input.positions[index] < input.positions[index - 1] - EPSILON) {
      return invalid("Path positions must be monotonic.");
    }
    if (!isFiniteNonnegative(input.velocityLimits[index])) return invalid(`Velocity limit ${index} must be finite and nonnegative.`);
  }
  for (let index = 0; index < count - 1; index += 1) {
    if (!(input.accelerationLimits[index] > 0) || !Number.isFinite(input.accelerationLimits[index])) {
      return invalid(`Acceleration limit ${index} must be finite and positive.`);
    }
    if (!(input.decelerationLimits[index] > 0) || !Number.isFinite(input.decelerationLimits[index])) {
      return invalid(`Deceleration limit ${index} must be finite and positive.`);
    }
    if (!(input.freeSpeeds[index] > 0) || !Number.isFinite(input.freeSpeeds[index])) {
      return invalid(`Free speed ${index} must be finite and positive.`);
    }
    if (input.motorAccelerationLimits
      && (!(input.motorAccelerationLimits[index] > 0) || !Number.isFinite(input.motorAccelerationLimits[index]))) {
      return invalid(`Motor acceleration limit ${index} must be finite and positive.`);
    }
    for (const constraint of input.accelerationConstraints?.[index] ?? []) {
      if (![constraint.uX, constraint.uY, constraint.xX, constraint.xY].every(Number.isFinite)
        || !(constraint.limit > 0) || !Number.isFinite(constraint.limit)) {
        return invalid(`Affine acceleration constraint ${index} must contain finite coefficients and a positive limit.`);
      }
    }
    for (const constraint of input.scalarAccelerationConstraints?.[index] ?? []) {
      if (![constraint.u, constraint.x, constraint.minimum, constraint.maximum].every(Number.isFinite)
        || constraint.minimum > constraint.maximum) {
        return invalid(`Scalar acceleration constraint ${index} must contain finite coefficients and ordered bounds.`);
      }
      const hasMotorEnvelope = constraint.velocityCoefficient !== undefined
        || constraint.freeSpeed !== undefined
        || constraint.motorAcceleration !== undefined;
      if (hasMotorEnvelope
        && (!(constraint.velocityCoefficient! >= 0) || !Number.isFinite(constraint.velocityCoefficient)
          || !(constraint.freeSpeed! > 0) || !Number.isFinite(constraint.freeSpeed)
          || !(constraint.motorAcceleration! > 0) || !Number.isFinite(constraint.motorAcceleration))) {
        return invalid(`Scalar acceleration constraint ${index} must contain a complete positive motor envelope.`);
      }
    }
  }

  const velocitySquaredLimits = input.velocityLimits.map((velocity) => velocity ** 2);
  const startSquared = input.startVelocity ** 2;
  const goalSquared = input.goalVelocity ** 2;
  const boundaryTolerance = 1e-8;
  if (startSquared > velocitySquaredLimits[0] + boundaryTolerance) {
    return invalid("Start velocity exceeds the local velocity limit.");
  }
  if (goalSquared > velocitySquaredLimits[count - 1] + boundaryTolerance) {
    return invalid("Goal velocity exceeds the local velocity limit.");
  }

  const controllable = new Array<ControllableInterval>(count);
  controllable[count - 1] = { minimum: goalSquared, maximum: goalSquared };
  for (let index = count - 2; index >= 0; index -= 1) {
    const predecessor = controllablePredecessor(
      input,
      index,
      velocitySquaredLimits[index],
      controllable[index + 1],
    );
    if (!predecessor) {
      return { status: "infeasible", velocities: [], iterations: count - 1, reason: `Drivetrain acceleration bounds are empty at interval ${index}.` };
    }
    controllable[index] = predecessor;
  }
  if (startSquared < controllable[0].minimum - boundaryTolerance) {
    return { status: "infeasible", velocities: [], iterations: count - 1, reason: "Goal velocity is unreachable from the authored start velocity and stops." };
  }
  if (startSquared > controllable[0].maximum + boundaryTolerance) {
    return { status: "infeasible", velocities: [], iterations: count - 1, reason: "Start velocity cannot decelerate to the authored goal and stops." };
  }

  const speedSquared = new Array<number>(count).fill(0);
  speedSquared[0] = startSquared;
  for (let index = 0; index < count - 1; index += 1) {
    const distance = Math.max(0, input.positions[index + 1] - input.positions[index]);
    if (distance <= EPSILON) {
      if (speedSquared[index] < controllable[index + 1].minimum - boundaryTolerance
        || speedSquared[index] > controllable[index + 1].maximum + boundaryTolerance) {
        return { status: "infeasible", velocities: [], iterations: count - 1 + index, reason: `Zero-distance interval ${index} requires incompatible velocities.` };
      }
      speedSquared[index + 1] = speedSquared[index];
      continue;
    }
    const control = controlBoundsForInterval(input, index, speedSquared[index], distance);
    if (!control) {
      return { status: "infeasible", velocities: [], iterations: count - 1 + index, reason: `Drivetrain acceleration bounds are empty at interval ${index}.` };
    }
    const reachableMinimum = speedSquared[index] + 2 * control.minimum * distance;
    const reachableMaximum = speedSquared[index] + 2 * control.maximum * distance;
    const nextMinimum = Math.max(controllable[index + 1].minimum, reachableMinimum, 0);
    const nextMaximum = Math.min(controllable[index + 1].maximum, reachableMaximum, velocitySquaredLimits[index + 1]);
    if (nextMinimum > nextMaximum + 1e-7) {
      return { status: "infeasible", velocities: [], iterations: count - 1 + index, reason: `Velocity caps require impossible acceleration at interval ${index}: ${nextMinimum} exceeds ${nextMaximum}.` };
    }
    speedSquared[index + 1] = nextMaximum;
  }
  if (Math.abs(speedSquared[count - 1] - goalSquared) > boundaryTolerance) {
    return { status: "infeasible", velocities: [], iterations: (count - 1) * 2, reason: "Goal velocity is unreachable from the authored start velocity and stops." };
  }
  speedSquared[count - 1] = goalSquared;

  for (let index = 0; index < count - 1; index += 1) {
    const distance = input.positions[index + 1] - input.positions[index];
    if (distance > EPSILON && speedSquared[index] + speedSquared[index + 1] <= EPSILON) {
      return {
        status: "invalid-input",
        velocities: [],
        iterations: (count - 1) * 2,
        reason: `Path interval ${index} must include a moving sample between stopped boundaries.`,
      };
    }
  }

  return {
    status: "optimal",
    velocities: speedSquared.map((value) => Math.sqrt(Math.max(0, value))),
    iterations: (count - 1) * 2,
  };
}
