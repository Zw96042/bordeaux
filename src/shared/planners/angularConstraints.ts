    if (active.velocity > EPSILON) scale = Math.max(scale, Math.abs(sample.angularVelocityRadps) / active.velocity);
    const kind = angularRateKind(previous.angularVelocityRadps, sample.angularVelocityRadps);
    const limit = kind === "acceleration" ? active.acceleration
      : kind === "deceleration" ? active.deceleration
        : Math.min(active.acceleration, active.deceleration);
    if (limit > EPSILON) {
      const measured = Math.abs(sample.angularVelocityRadps - previous.angularVelocityRadps) / dt;
      scale = Math.max(scale, Math.sqrt(measured / limit));
    }
  }
  return scale;
}

/**
 * Slows the moving trajectory uniformly when angular motion needs more time.
 * Uniform scaling preserves every linear and angular path shape while reducing
 * velocity by 1/scale and acceleration by 1/scale².
 */
export function enforceAngularTiming(path: PathDoc, result: PlannerResult, afterRotationPriority = false): PlannerResult {
  if (result.samples.length < 2) return result;
  // Translation-priority heading is causally slewed by applyRotationPriority.
  // Stationary turns and jiggles have not been inserted yet at this stage, so
  // their presence must not disable enforcement on the moving trajectory.
  if (!afterRotationPriority && (path.ranges.some((range) => range.rotationPriority === "translation")
    || path.waypoints.some((waypoint) => waypoint.headingTransition?.rotationPriority === "translation"))) return result;
  const required = requiredTimeScale(path, result.samples, result.waypointSampleIndices);
  if (!Number.isFinite(required)) {
    return {
      ...result,
      diagnostics: [...result.diagnostics, {
        severity: "error",
        path: `paths.${path.name}.constraints`,
        message: "Trajectory cannot satisfy the configured angular limits",
      }],
    };
  }
  if (required <= 1 + EPSILON) return result;

  const scale = required * SAFETY_SCALE;
  const samples = result.samples.map((sample) => ({
    ...sample,
    t: sample.t * scale,
    velocityMps: sample.velocityMps / scale,
    accelerationMps2: sample.accelerationMps2 / (scale * scale),
    angularVelocityRadps: sample.angularVelocityRadps / scale,
  }));
  const markers = result.markers.map((marker) => ({ ...marker, timeS: marker.timeS * scale }));
  const totalTimeS = samples.at(-1)?.t ?? result.totalTimeS * scale;
  return {
    ...result,
    totalTimeS,
    samples,
    markers,
    optimization: result.optimization ? {
      ...result.optimization,
      totalTimeS,
      maxVelocityMps: result.optimization.maxVelocityMps / scale,
      maxAccelerationMps2: result.optimization.maxAccelerationMps2 / (scale * scale),
    } : result.optimization,
  };
}

export function addAngularLimitDiagnostics(path: PathDoc, result: PlannerResult): PlannerResult {
  if (result.samples.length < 2 || requiredTimeScale(path, result.samples, result.waypointSampleIndices) <= 1.02) return result;
  return {
    ...result,
    diagnostics: [...result.diagnostics, {
      severity: "error",
      path: `paths.${path.name}.constraints`,
      message: "Trajectory exceeds the configured angular velocity, acceleration, or deceleration limits",
    }],
  };
}
