      metrics,
      anchors: buildAnchors(points.map((point) => ({ f: point.f, rad: point.heading }))),
      // Shared planner samples already contain the robot's physical heading.
      rev: false,
    },
    prof: { ...prof, t: mapped(prof.t), v: mapped(prof.v) },
    metrics: Object.assign({}, metrics, {
      v: mapped(metrics.v), accel: mapped(metrics.accel), omega: mapped(metrics.omega),
      curv: mapped(metrics.curv), head: mapped(metrics.head),
    }),
    anchors: buildAnchors(geometryPoints.map((point, index) => ({
      f: geometryPoints.length > 1 ? point.s / Math.max(1e-9, geometryPoints[geometryPoints.length - 1].s) : 0,
      rad: metrics.head[geometryIndices[index]],
    }))),
  };
}

export function derivePlannerPreview(path, robot, samplesPerSegment, plannerId) {
  const result = getPlanner(plannerId).generate({ path, robot, samplesPerSegment });
  if (result.planner !== plannerId) {
    throw new Error(result.optimization?.fallbackReason
      || result.diagnostics.find((issue) => issue.message.includes('fell back'))?.message
      || `${plannerId} did not produce a final trajectory.`);
  }
  const sample = PM.sample(path.waypoints, samplesPerSegment);
  const lastIndex = Math.max(0, sample.pts.length - 1);
  const wpIdx = path.waypoints.map((_, index) => Math.min(lastIndex, index * samplesPerSegment));
  const total = sample.length || 1;
  const wpFrac = wpIdx.map((index) => sample.pts.length ? sample.pts[index].s / total : 0);
  const headingMode = robot?.drive === 'tank' ? 'tangent' : (path.headingMode || 'targets');
  const mode = path.waypoints.slice(0, -1).every((waypoint) => (
    robot?.drive === 'tank' || (waypoint.segmentHeadingMode || headingMode) === 'tangent'
  )) ? 'tank' : 'swerve';
  const shared = plannerPlayback(result, sample.pts, !!path.driveBackward);
  const checks = result.diagnostics.map((issue) => ({
    f: 0, kind: 'planner', level: issue.severity, text: issue.message, seg: 0,
  }));
  return {
    sample,
    prof: shared.prof,
    totalDistance: result.totalDistanceM,
    anchors: shared.anchors,
    metrics: shared.metrics,
    checks,
    wpFrac,
    wpIdx,
    mode,
    effRanges: PM.effectiveRanges(path, sample),
    headingMode,
    rev: !!path.driveBackward,
    playback: shared.playback,
    markers: result.markers,
    planner: result.planner,
  };
}
