import { LABVIEW_BDX_MAX_TRAJECTORY_POINTS } from "../export/labviewBdxReader";
import { PM } from "../math/pm";
import type { ConstraintRange, PathDoc, PlannerResult, RobotConfig, TrajectorySample } from "../types";

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function directedDelta(start: number, end: number, direction = "shortest"): number {
  let delta = wrapRadians(end - start);
  if (Math.abs(delta) < EPSILON) return 0;
  if (direction === "clockwise" && delta > 0) delta -= Math.PI * 2;
  if (direction === "counterclockwise" && delta < 0) delta += Math.PI * 2;
  return delta;
}

function activeAngularLimits(path: PathDoc, fraction: number, waypointIndex: number, totalDistance: number): { velocity: number; acceleration: number; jerk: number } {
  let velocity = path.constraints.maxAngVel * DEG;
  let acceleration = Math.min(path.constraints.maxAngAccel, path.constraints.maxAngDecel ?? path.constraints.maxAngAccel) * DEG;
  const jerk = (path.constraints.maxAngJerk ?? 0) * DEG;
  (path.ranges ?? []).forEach((range: ConstraintRange) => {
    let active: boolean;
    if (range.anchor === "wp") {
      const start = (range.w0 ?? 0) + (range.t0 ?? 0);
      const end = (range.w1 ?? path.waypoints.length - 1) + (range.t1 ?? 0);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      active = waypointIndex >= lo - EPSILON && waypointIndex <= hi + EPSILON;
    } else {
      const first = range.anchor === "dist" ? (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f0;
      const last = range.anchor === "dist" ? (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f1;
      const lo = Math.min(first, last), hi = Math.max(first, last);
      active = fraction >= lo - EPSILON && fraction <= hi + EPSILON;
    }
    if (active) {
      velocity = Math.min(velocity, range.maxAngVel * DEG);
      acceleration = Math.min(acceleration, range.maxAngAccel * DEG);
    }
  });
  return { velocity: Math.max(velocity, EPSILON), acceleration: Math.max(acceleration, EPSILON), jerk };
}

function activeLinearLimits(path: PathDoc, fraction: number, waypointIndex: number, totalDistance: number): { velocity: number; acceleration: number; deceleration: number } {
  let velocity = path.constraints.maxVel;
  let acceleration = path.constraints.maxAccel;
  let deceleration = path.constraints.maxDecel ?? path.constraints.maxAccel;
  (path.ranges ?? []).forEach((range: ConstraintRange) => {
    let active: boolean;
    if (range.anchor === "wp") {
      const start = (range.w0 ?? 0) + (range.t0 ?? 0);
      const end = (range.w1 ?? path.waypoints.length - 1) + (range.t1 ?? 0);
      active = waypointIndex >= Math.min(start, end) - EPSILON && waypointIndex <= Math.max(start, end) + EPSILON;
    } else {
      const first = range.anchor === "dist" ? (range.d0 ?? range.f0 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f0;
      const last = range.anchor === "dist" ? (range.d1 ?? range.f1 * totalDistance) / Math.max(totalDistance, EPSILON) : range.f1;
      active = fraction >= Math.min(first, last) - EPSILON && fraction <= Math.max(first, last) + EPSILON;
    }
    if (active) {
      velocity = Math.min(velocity, range.maxVel);
      acceleration = Math.min(acceleration, range.maxAccel);
      deceleration = Math.min(deceleration, range.maxDecel ?? range.maxAccel);
    }
  });
  return {
    velocity: Math.max(velocity, EPSILON),
    acceleration: Math.max(acceleration, EPSILON),
    deceleration: Math.max(deceleration, EPSILON),
  };
}

function feasibleJiggleStrokeDuration(requested: number, distance: number, limits: ReturnType<typeof activeLinearLimits>, freeSpeed: number): number {
  const minimum = Math.max(
    requested,
    4 * distance / Math.min(limits.velocity, freeSpeed),
    Math.sqrt(16 * distance / limits.deceleration),
  );
  const feasible = (duration: number) => {
    const peakVelocity = 4 * distance / duration;
    const availableAcceleration = limits.acceleration * Math.max(0, 1 - peakVelocity / freeSpeed);
    return 16 * distance / (duration * duration) <= availableAcceleration + 1e-9;
  };
  if (feasible(minimum)) return minimum;
  let low = minimum, high = minimum;
  while (!feasible(high)) high *= 2;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    if (feasible(middle)) high = middle;
    else low = middle;
  }
  return high;
}

function samplePeriod(path: PathDoc, samples: readonly TrajectorySample[]): number {
  if (path.labview?.samplePeriodS && path.labview.samplePeriodS >= 0.001) return path.labview.samplePeriodS;
  let best = Infinity;
  for (let index = 1; index < samples.length; index += 1) {
    const dt = samples[index].t - samples[index - 1].t;
    if (dt > EPSILON) best = Math.min(best, dt);
  }
  return Number.isFinite(best) ? Math.max(0.01, Math.min(0.05, best)) : 0.02;
}

function waypointSampleIndices(path: PathDoc, samples: readonly TrajectorySample[]): number[] {
  let cursor = 0;
  return path.waypoints.map((waypoint, waypointIndex) => {
    if (waypointIndex === path.waypoints.length - 1) return samples.length - 1;
    let best = cursor, distance = Infinity;
    for (let index = cursor; index < samples.length; index += 1) {
      const candidate = Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y);
      if (candidate < distance) { best = index; distance = candidate; }
      if (distance < 1e-5 && candidate > distance + 1e-4) break;
    }
    cursor = best;
    return best;
  });
}

function firstMovingSampleIndex(samples: readonly TrajectorySample[], boundary: number): number | null {
  const arrival = samples[boundary];
  for (let index = boundary + 1; index < samples.length; index += 1) {
    const sample = samples[index];
    if (Math.hypot(sample.x - arrival.x, sample.y - arrival.y) > 1e-5 || Math.abs(sample.s - arrival.s) > 1e-6) return index;
  }
  return null;
}

function rotationDuration(delta: number, limits: ReturnType<typeof activeAngularLimits>): number {
  const distance = Math.abs(delta);
  if (distance < EPSILON) return 0;
  return Math.max(
    distance * 1.875 / limits.velocity,
    Math.sqrt(distance * 5.77351 / limits.acceleration),
    limits.jerk > EPSILON ? Math.cbrt(distance * 60 / limits.jerk) : 0,
  );
}

function jigglePhase(progress: number): { position: number; velocity: number; acceleration: number; travel: number } {
  const u = Math.max(0, Math.min(1, progress));
  if (u < 0.25) return { position: 8 * u * u, velocity: 16 * u, acceleration: 16, travel: 8 * u * u };
  if (u < 0.5) {
    const remaining = 0.5 - u;
    const position = 1 - 8 * remaining * remaining;
    return { position, velocity: 16 * remaining, acceleration: -16, travel: position };
  }
  if (u < 0.75) {
    const elapsed = u - 0.5;
    const position = 1 - 8 * elapsed * elapsed;
    return { position, velocity: -16 * elapsed, acceleration: -16, travel: 2 - position };
  }
  const remaining = 1 - u;
  const position = 8 * remaining * remaining;
  return { position, velocity: -16 * remaining, acceleration: 16, travel: 2 - position };
}

/** Adds optional waypoint actions after a planner has finished its authored geometry. */
export function applyStationaryActions(path: PathDoc, result: PlannerResult, robot?: RobotConfig): PlannerResult {
  const actions = path.waypoints
    .map((waypoint, index) => ({ waypoint, index }))
    .filter(({ waypoint }) => waypoint.turnInPlace || waypoint.jiggle || (waypoint.wait ?? 0) > 0);
  if (actions.length === 0 || result.samples.length === 0) return result;

  const baseIndices = waypointSampleIndices(path, result.samples);
  const incompatible = actions.find(({ waypoint, index }) => {
    if (!waypoint.turnInPlace) return false;
    if (index >= path.waypoints.length - 1) return false;
    const boundary = baseIndices[index];
    const movingIndex = firstMovingSampleIndex(result.samples, boundary);
    const outgoing = movingIndex == null ? null : result.samples[movingIndex].headingRad;
    const target = waypoint.turnInPlace!.headingDeg * DEG + (path.driveBackward ? Math.PI : 0);
    return outgoing == null || Math.abs(wrapRadians(outgoing - target)) > 2 * DEG;
  });
  if (incompatible) {
    return {
      ...result,
      diagnostics: [...result.diagnostics, {
        severity: "error",
        path: `paths.${path.name}.waypoints[${incompatible.index}].turnInPlace`,
        message: "Interior turn heading must match the outgoing segment heading",
      }],
    };
  }
  const period = samplePeriod(path, result.samples);
  const samples = result.samples.map((sample) => ({ ...sample }));
  const markers = result.markers.map((marker) => ({ ...marker }));
  const diagnostics = [...result.diagnostics];
  let inserted = 0;
  let addedDistance = 0;

  actions.forEach(({ waypoint, index: waypointIndex }) => {
    const turn = waypoint.turnInPlace;
    const boundary = baseIndices[waypointIndex] + inserted;
    const arrival = samples[boundary];
    const previous = samples[Math.max(0, boundary - 1)];
    const startHeading = waypointIndex === 0 ? arrival.headingRad : previous.headingRad;
    const targetHeading = turn ? turn.headingDeg * DEG + (path.driveBackward ? Math.PI : 0) : arrival.headingRad;
    const delta = turn ? directedDelta(startHeading, targetHeading, turn.direction) : 0;
    const limits = activeAngularLimits(path, arrival.f, waypointIndex, result.totalDistanceM);
    const rawDuration = rotationDuration(delta, limits);
    const turnTicks = rawDuration > EPSILON ? Math.max(1, Math.ceil(rawDuration / period - EPSILON)) : 0;
    const turnDuration = turnTicks * period;
    const jiggle = waypoint.jiggle;
    const jiggleHeading = turn ? targetHeading : arrival.headingRad;
    const jiggleSupported = !jiggle || robot?.drive !== "tank";
    const jigglePositions = jiggle && jiggleSupported ? PM.jigglePositions(waypoint, jiggleHeading, jiggle) : null;
    if (jiggle && !jiggleSupported) {
      diagnostics.push({
        severity: "error",
        path: `paths.${path.name}.waypoints[${waypointIndex}].jiggle`,
        message: "Arbitrary-direction jiggle requires a swerve drivetrain",
      });
    }
    if (jiggle && jiggleSupported && !jigglePositions) {
      diagnostics.push({
        severity: "error",
        path: `paths.${path.name}.waypoints[${waypointIndex}].jiggle`,
        message: "Jiggle directions must be unique and every stroke must stay on the field",
      });
    }
    const linearLimits = activeLinearLimits(path, arrival.f, waypointIndex, result.totalDistanceM);
    const requestedJiggleDuration = jiggle && jigglePositions
      ? feasibleJiggleStrokeDuration(jiggle.strokeTimeS, jiggle.distanceM, linearLimits, Math.max(robot?.maxSpeed ?? linearLimits.velocity, EPSILON))
      : 0;
    const jiggleTicks = jiggle && jigglePositions
      ? Math.max(1, Math.ceil(requestedJiggleDuration / period - EPSILON))
      : 0;
    const jiggleStrokeDuration = jiggleTicks * period;
    const jiggleDuration = jiggle && jigglePositions ? jiggleStrokeDuration * jiggle.strokes : 0;
    const waitTicks = Math.max(0, Math.ceil(Math.max(0, waypoint.wait ?? 0) / period - EPSILON));
    const waitDuration = waitTicks * period;
    const duration = turnDuration + jiggleDuration + waitDuration;
    if (duration <= EPSILON) return;
    const arrivalTime = arrival.t;

    if (turn) arrival.headingRad = startHeading;
    arrival.velocityMps = 0;
    arrival.accelerationMps2 = 0;
    if (turn) {
      const firstMoving = firstMovingSampleIndex(samples, boundary);
      for (let sampleIndex = boundary + 1; sampleIndex < (firstMoving ?? samples.length); sampleIndex += 1) {
        samples[sampleIndex].headingRad = targetHeading;
      }
    }
    for (let sampleIndex = boundary + 1; sampleIndex < samples.length; sampleIndex += 1) samples[sampleIndex].t += duration;
    markers.forEach((marker) => {
      const afterArrival = marker.timeS > arrivalTime + EPSILON;
      const terminalAtArrival = waypointIndex === path.waypoints.length - 1
        && marker.fraction >= 1 - EPSILON
        && Math.abs(marker.timeS - arrivalTime) <= EPSILON;
      if (afterArrival || terminalAtArrival) marker.timeS += duration;
    });

    const turnSamples: TrajectorySample[] = [];
    for (let tick = 1; tick <= turnTicks; tick += 1) {
      const u = tick / turnTicks;
      const progress = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
      turnSamples.push({
        ...arrival,
        i: 0,
        t: arrivalTime + tick * period,
        headingRad: startHeading + delta * progress,
        velocityMps: 0,
        accelerationMps2: 0,
        angularVelocityRadps: 0,
      });
    }
    const waitHeading = turn ? targetHeading : arrival.headingRad;
    const jiggleSamples: TrajectorySample[] = [];
    if (jiggle && jigglePositions) {
      for (let stroke = 0; stroke < jiggle.strokes; stroke += 1) {
        const angle = jiggleHeading + (jiggle.startDeg + jiggle.stepDeg * stroke) * DEG;
        for (let tick = 1; tick <= jiggleTicks; tick += 1) {
          const u = tick / jiggleTicks;
          const phase = jigglePhase(u);
          const radialDistance = jiggle.distanceM * phase.position;
          jiggleSamples.push({
            ...arrival,
            i: 0,
            t: arrivalTime + turnDuration + stroke * jiggleStrokeDuration + tick * period,
            s: arrival.s + addedDistance + stroke * jiggle.distanceM * 2 + jiggle.distanceM * phase.travel,
            f: 1,
            x: arrival.x + Math.cos(angle) * radialDistance,
            y: arrival.y + Math.sin(angle) * radialDistance,
            headingRad: jiggleHeading,
            velocityMps: Math.abs(phase.velocity) * jiggle.distanceM / jiggleStrokeDuration,
            accelerationMps2: tick === jiggleTicks ? 0 : phase.acceleration * jiggle.distanceM / (jiggleStrokeDuration * jiggleStrokeDuration),
            angularVelocityRadps: 0,
            curvatureInvM: 0,
          });
        }
      }
      addedDistance += jiggle.distanceM * 2 * jiggle.strokes;
    }
    const waitSamples: TrajectorySample[] = [];
    for (let tick = 1; tick <= waitTicks; tick += 1) {
      waitSamples.push({
        ...arrival,
        i: 0,
        t: arrivalTime + turnDuration + jiggleDuration + tick * period,
        s: arrival.s + addedDistance,
        f: 1,
        headingRad: jiggleSamples.at(-1)?.headingRad ?? waitHeading,
        velocityMps: 0,
        accelerationMps2: 0,
        angularVelocityRadps: 0,
      });
    }
    samples.splice(boundary + 1, 0, ...turnSamples, ...jiggleSamples, ...waitSamples);
    inserted += turnSamples.length + jiggleSamples.length + waitSamples.length;
  });

  if (samples.length > LABVIEW_BDX_MAX_TRAJECTORY_POINTS) throw new Error(`Stationary actions require ${samples.length} samples, exceeding the LabVIEW .bdx limit of ${LABVIEW_BDX_MAX_TRAJECTORY_POINTS}`);
  samples.forEach((sample, index) => {
    sample.i = index;
    if (index === 0) sample.angularVelocityRadps = 0;
    else {
      const before = samples[index - 1];
      sample.headingRad = before.headingRad + wrapRadians(sample.headingRad - before.headingRad);
      sample.angularVelocityRadps = (sample.headingRad - before.headingRad) / Math.max(EPSILON, sample.t - before.t);
    }
  });
  const totalTimeS = samples.at(-1)?.t ?? result.totalTimeS;
  return {
    ...result,
    totalTimeS,
    totalDistanceM: result.totalDistanceM + addedDistance,
    samples,
    markers,
    diagnostics,
    optimization: result.optimization ? { ...result.optimization, totalTimeS } : result.optimization,
  };
}
