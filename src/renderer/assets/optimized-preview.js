import { getPlanner } from "../../shared/planners";
import { PM } from "../../shared/math/pm";

function buildAnchors(entries) {
  const anchors = (entries || []).filter((entry) => entry && Number.isFinite(entry.f) && Number.isFinite(entry.rad))
    .map((entry) => ({ f: Math.max(0, Math.min(1, entry.f)), rad: entry.rad }))
    .sort((first, second) => first.f - second.f);
  if (!anchors.length) return [{ f: 0, rad: 0 }, { f: 1, rad: 0 }];
  if (anchors[0].f > 1e-6) anchors.unshift({ f: 0, rad: anchors[0].rad });
  if (anchors[anchors.length - 1].f < 1 - 1e-6) anchors.push({ f: 1, rad: anchors[anchors.length - 1].rad });
  return anchors;
}

function plannerPlayback(result, geometryPoints, reverse) {
  const samples = result.samples || [];
  const points = samples.map((sample) => ({
    x: sample.x,
    y: sample.y,
    s: sample.s,
    f: sample.f,
    heading: sample.headingRad - (reverse ? Math.PI : 0),
    plannedHeading: sample.headingRad,
    curv: sample.curvatureInvM,
  }));
  const prof = {
    t: samples.map((sample) => sample.t),
    v: samples.map((sample) => sample.velocityMps),
    totalTime: result.totalTimeS,
    holds: [], turns: [], jiggles: [],
  };
  const metrics = {
    v: prof.v,
    accel: samples.map((sample) => sample.accelerationMps2),
    omega: samples.map((sample) => sample.angularVelocityRadps),
    curv: samples.map((sample) => sample.curvatureInvM),
    head: samples.map((sample) => sample.headingRad - (reverse ? Math.PI : 0)),
  };
  metrics.vMax = metrics.v.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  metrics.aMax = metrics.accel.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  metrics.wMax = metrics.omega.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  metrics.kMax = metrics.curv.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

  const geometryIndices = [];
  let cursor = 0;
  geometryPoints.forEach((point) => {
    while (cursor < samples.length && (
      Math.abs(samples[cursor].x - point.x) > 0.0001
      || Math.abs(samples[cursor].y - point.y) > 0.0001
      || Math.abs(samples[cursor].s - point.s) > 0.0001
    )) cursor++;
    geometryIndices.push(Math.min(cursor, Math.max(0, samples.length - 1)));
    if (cursor < samples.length - 1) cursor++;
  });
  const mapped = (values) => geometryIndices.map((index) => values[index]);
  return {
    playback: {
      pts: points,
      prof,
      metrics,
      anchors: buildAnchors(points.map((point) => ({ f: point.f, rad: point.heading }))),
      rev: reverse,
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
