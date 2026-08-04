import { PM } from "../math/pm";
import type {
  BdxMarker,
  PlannerInput,
  PlannerResult,
  TrajectoryPlanner,
  TrajectorySample,
  ValidationIssue,
} from "../types";

const SAMPLES_PER_SEGMENT = 56;
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

function markersFor(input: PlannerInput, pts: Array<{ s: number }>, times: number[]): BdxMarker[] {
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
      timeS: R(timeAtFraction(fraction, pts, times), 4),
      fraction: R(fraction, 5),
    };
  });
}

export const profiledSplinePlanner: TrajectoryPlanner = {
  id: "profiledSpline",
  generate(input: PlannerInput): PlannerResult {
    // Stationary rotations are sampled by the shared post-processor. Keep the
    // authored turn visible to heading continuity, but do not time it here.
    const derived = PM.derivePath(input.path, input.robot, input.samplesPerSegment ?? SAMPLES_PER_SEGMENT, { skipStationaryActions: true });
    const pts = derived.sample.pts || [];
    const metrics = derived.metrics || {};
    const times = derived.prof.t || [];
    const totalDistanceM = derived.sample.length || 0;

    const samples: TrajectorySample[] = pts.map((point: any, i: number) => ({
      i,
      t: R(times[i] ?? 0, 4),
      s: R(point.s ?? 0, 4),
      f: R(totalDistanceM > 1e-9 ? (point.s ?? 0) / totalDistanceM : 0, 5),
      x: R(point.x ?? 0, 4),
      y: R(point.y ?? 0, 4),
      headingRad: R((metrics.head?.[i] ?? point.heading ?? 0) + (derived.rev ? Math.PI : 0), 5),
      velocityMps: R(metrics.v?.[i] ?? 0, 4),
      accelerationMps2: R(metrics.accel?.[i] ?? 0, 4),
      angularVelocityRadps: R(metrics.omega?.[i] ?? 0, 5),
      curvatureInvM: R(metrics.curv?.[i] ?? point.curv ?? 0, 5),
    }));

