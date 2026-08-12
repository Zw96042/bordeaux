import { enforceAngularTiming } from "../../shared/planners/angularConstraints";
import { optimizePlannerMotion } from "../../shared/planners/optimizationCore";
import { finalizePlannerMotion } from "../../shared/planners/pipeline";
import { PM } from "../lib/pathMath";

const round = (value, places = 4) => Number(value.toFixed(places));

function markerFraction(marker, distance) {
  return marker.anchor === 'dist' && distance > 1e-9
    ? Math.max(0, Math.min(1, (marker.d != null ? marker.d : marker.f * distance) / distance))
    : marker.f;
}

function profiledResult(input, derived) {
  const points = derived.sample.pts || [];
  const metrics = derived.metrics || {};
  const times = derived.prof.t || [];
  const distance = derived.sample.length || 0;
  const samples = points.map((point, index) => ({
    i: index,
    t: round(times[index] || 0),
    s: round(point.s || 0),
    f: round(distance > 1e-9 ? (point.s || 0) / distance : 0, 5),
    x: round(point.x || 0),
    y: round(point.y || 0),
    headingRad: round((metrics.head[index] ?? point.heading ?? 0) + (derived.rev ? Math.PI : 0), 5),
    velocityMps: round(metrics.v[index] || 0),
    accelerationMps2: round(metrics.accel[index] || 0),
    angularVelocityRadps: round(metrics.omega[index] || 0, 5),
    curvatureInvM: round(metrics.curv[index] ?? point.curv ?? 0, 5),
  }));
  const markers = (input.path.markers || []).map((marker, index) => ({
    id: marker.id != null ? marker.id : input.path.id + ':event:' + index,
    name: marker.name,
    command: marker.cmd != null ? marker.cmd : null,
    ...(marker.invocation ? { invocation: marker.invocation } : {}),
    group: marker.group != null ? marker.group : null,
    timeS: 0,
    fraction: round(markerFraction(marker, distance), 5),
  }));
  return enforceAngularTiming(input.path, {
    planner: 'profiledSpline',
    totalTimeS: round(derived.prof.totalTime || 0),
    totalDistanceM: round(distance),
    samples,
    markers,
    diagnostics: [],
  });
}

function prepareInput(path, robot, samplesPerSegment) {
  const hardLimits = PM.robotHardLimits(robot);
  const physicalRobot = hardLimits ? { ...robot, maxSpeed: hardLimits.maxSpeed } : robot;
  const constraints = PM.effectiveConstraints(path.constraints, physicalRobot);
  const physicalPath = constraints === path.constraints ? path : { ...path, constraints };
  const planningPath = physicalPath.waypoints.some((waypoint) => waypoint.turnInPlace || (waypoint.stop && (waypoint.wait || 0) > 0))
    ? {
        ...physicalPath,
        waypoints: physicalPath.waypoints.map((waypoint) => waypoint.stop && (waypoint.wait || 0) > 0 ? { ...waypoint, wait: 0 } : waypoint),
      }
    : physicalPath;
  return {
    path: physicalPath,
    robot: physicalRobot,
    planningInput: { path: planningPath, robot: physicalRobot, samplesPerSegment },
  };
}

function buildAnchors(entries) {
  const anchors = (entries || []).filter((entry) => entry && Number.isFinite(entry.f) && Number.isFinite(entry.rad))
    .map((entry) => ({ f: Math.max(0, Math.min(1, entry.f)), rad: entry.rad }))
    .sort((first, second) => first.f - second.f);
  if (!anchors.length) return [{ f: 0, rad: 0 }, { f: 1, rad: 0 }];
  if (anchors[0].f > 1e-6) anchors.unshift({ f: 0, rad: anchors[0].rad });
  if (anchors[anchors.length - 1].f < 1 - 1e-6) anchors.push({ f: 1, rad: anchors[anchors.length - 1].rad });
  return anchors;
}

function optimizedPlayback(result, geometryPoints, reverse) {
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
    while (cursor < samples.length && Math.hypot(samples[cursor].x - point.x, samples[cursor].y - point.y) > 0.001) cursor++;
    geometryIndices.push(Math.min(cursor, Math.max(0, samples.length - 1)));
    if (cursor < samples.length - 1) cursor++;
  });
  const mapped = (values) => geometryIndices.map((index) => values[index]);
  return {
    playback: {
      pts: points,
      prof,
      metrics,
      anchors: buildAnchors(points.map((point) => ({ f: point.f, rad: point.plannedHeading }))),
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

export function deriveOptimizedPreview(path, robot, samplesPerSegment) {
  const prepared = prepareInput(path, robot, samplesPerSegment);
  const derived = PM.derivePath(prepared.planningInput.path, prepared.planningInput.robot, samplesPerSegment, 'profiledSpline');
  const base = profiledResult(prepared.planningInput, derived);
  if (base.samples.length < 2) {
    throw new Error('Profiled spline did not produce enough samples for optimization.');
  }
  const generated = optimizePlannerMotion(prepared.planningInput, base);
  const result = finalizePlannerMotion(prepared.path, prepared.robot, generated);
  const shared = optimizedPlayback(result, derived.sample.pts, !!prepared.path.driveBackward);
  const checks = [...derived.checks];
  result.diagnostics.forEach((issue) => checks.push({ f: 0, kind: 'planner', level: issue.severity, text: issue.message, seg: 0 }));
  return {
    ...derived,
    prof: shared.prof,
    totalDistance: result.totalDistanceM,
    anchors: shared.anchors,
    metrics: shared.metrics,
    checks,
    playback: shared.playback,
    markers: result.markers,
    planner: result.planner,
  };
}
