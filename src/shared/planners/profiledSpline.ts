import { PM } from "../math/pm";
import type {
  BdxMarker,
  PlannerInput,
  PlannerResult,
  TrajectoryPlanner,
  TrajectorySample,
  ValidationIssue,
} from "../types";
import { DEFAULT_SAMPLES_PER_SEGMENT, MAX_TRAJECTORY_SAMPLES } from "./limits";

const R = (value: number, places = 4) => Number(value.toFixed(places));

function timeAtFraction(fraction: number, pts: Array<{ s: number }>, times: number[]): number {
  if (pts.length < 2 || times.length !== pts.length) return 0;
  const total = pts[pts.length - 1].s || 0;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  if (target <= 0) return times[0] ?? 0;
  if (target >= total) return times[times.length - 1] ?? 0;

  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i].s >= target) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const span = Math.max(1e-9, curr.s - prev.s);
      const u = (target - prev.s) / span;
      return (times[i - 1] ?? 0) + ((times[i] ?? 0) - (times[i - 1] ?? 0)) * u;
    }
  }

  return times[times.length - 1] ?? 0;
}

function diagnosticsFor(pathName: string, derived: any): ValidationIssue[] {
  return (derived.warnings || []).map((warning: any, index: number) => ({
    severity: warning.sev === "high" && warning.kind !== "vel" ? "error" : "warning",
    path: `paths.${pathName}.diagnostics[${index}]`,
    message: warning.text || "Trajectory diagnostic",
  }));
}

function markersFor(
  input: PlannerInput,
  pts: Array<{ s: number }>,
  times: number[],
  fullPrecision: boolean,
): BdxMarker[] {
  const length = pts[pts.length - 1]?.s ?? 0;
  return (input.path.markers || []).map((marker, index) => {
    const fraction = marker.anchor === "dist" && length > 1e-9
      ? Math.max(0, Math.min(1, (marker.d ?? marker.f * length) / length))
      : marker.f;
    return {
      id: marker.id ?? `${input.path.id}:event:${index}`,
      name: marker.name,
      command: marker.cmd ?? null,
      ...(marker.invocation ? { invocation: marker.invocation } : {}),
      group: marker.group ?? null,
      timeS: fullPrecision ? timeAtFraction(fraction, pts, times) : R(timeAtFraction(fraction, pts, times), 4),
      fraction: fullPrecision ? fraction : R(fraction, 5),
    };
  });
}

function generateProfiledSpline(input: PlannerInput, fullPrecision: boolean): PlannerResult {
  const samplesPerSegment = input.samplesPerSegment ?? DEFAULT_SAMPLES_PER_SEGMENT;
  if (!Number.isInteger(samplesPerSegment) || samplesPerSegment < 1) {
    throw new Error("Planner samples per segment must be a positive integer");
  }
  const segmentCount = Math.max(0, input.path.waypoints.length - 1);
  if (segmentCount > Math.floor((MAX_TRAJECTORY_SAMPLES - 1) / samplesPerSegment)) {
    throw new Error(`Path requires more than ${MAX_TRAJECTORY_SAMPLES} trajectory samples`);
  }
  // Stationary rotations are sampled by the shared post-processor. Keep the
  // authored turn visible to heading continuity, but do not time it here.
  const derived = PM.derivePath(input.path, input.robot, samplesPerSegment, { skipStationaryActions: true });
  const pts = derived.sample.pts || [];
  const metrics = derived.metrics || {};
  const times = derived.prof.t || [];
  const totalDistanceM = derived.sample.length || 0;
  const value = (number: number, places: number) => fullPrecision ? number : R(number, places);
  const samples: TrajectorySample[] = pts.map((point: any, i: number) => ({
    i,
    t: value(times[i] ?? 0, 4),
    s: value(point.s ?? 0, 4),
    f: value(totalDistanceM > 1e-9 ? (point.s ?? 0) / totalDistanceM : 0, 5),
    x: value(point.x ?? 0, 4),
    y: value(point.y ?? 0, 4),
    headingRad: value((metrics.head?.[i] ?? point.heading ?? 0) + (derived.rev ? Math.PI : 0), 5),
    velocityMps: value(metrics.v?.[i] ?? 0, 4),
    accelerationMps2: value(metrics.accel?.[i] ?? 0, 4),
    angularVelocityRadps: value(metrics.omega?.[i] ?? 0, 5),
    curvatureInvM: value(metrics.curv?.[i] ?? point.curv ?? 0, 5),
  }));

  return {
    planner: "profiledSpline",
    totalTimeS: value(derived.prof.totalTime || 0, 4),
    totalDistanceM: value(totalDistanceM, 4),
    samples,
    markers: markersFor(input, pts, times, fullPrecision),
    diagnostics: diagnosticsFor(input.path.name, derived),
  };
}

export function profiledSplineOptimizationSeed(input: PlannerInput): PlannerResult {
  return generateProfiledSpline(input, true);
}

export const profiledSplinePlanner: TrajectoryPlanner = {
  id: "profiledSpline",
  generate(input: PlannerInput): PlannerResult {
    return generateProfiledSpline(input, false);
  },
};
