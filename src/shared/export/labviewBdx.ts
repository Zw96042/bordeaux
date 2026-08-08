import { buildBdxExport } from "./bdx";
import { LABVIEW_BDX_MAX_TRAJECTORY_POINTS, LABVIEW_BDX_MAX_WAYPOINTS } from "./labviewBdxReader";
import type { BdxPath, BordeauxProject, PathDoc, TrajectorySample } from "../types";

const BDX_VERSION = "4.4";
const FEET_PER_METER = 3.280839895013123;
const DEFAULT_SAMPLE_PERIOD_S = 0.02;

class LabviewBinaryWriter {
  private readonly chunks: Buffer[] = [];

  bytes(value: Uint8Array): void {
    this.chunks.push(Buffer.from(value));
  }

  string(value: string): void {
    const encoded = Buffer.from(value, "utf8");
    this.u32(encoded.length);
    this.bytes(encoded);
  }

  boolean(value: boolean): void {
    const data = Buffer.alloc(1);
    data.writeUInt8(value ? 1 : 0);
    this.chunks.push(data);
  }

  u16(value: number): void {
    const data = Buffer.alloc(2);
    data.writeUInt16BE(value);
    this.chunks.push(data);
  }

  i32(value: number): void {
    const data = Buffer.alloc(4);
    data.writeInt32BE(value);
    this.chunks.push(data);
  }

  u32(value: number): void {
    const data = Buffer.alloc(4);
    data.writeUInt32BE(value);
    this.chunks.push(data);
  }

  f64(value: number): void {
    const data = Buffer.alloc(8);
    data.writeDoubleBE(value);
    this.chunks.push(data);
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

interface UniformSample {
  xFt: number;
  yFt: number;
  headingDeg: number;
  velocityFps: number;
  omegaDegps: number;
}

type LabviewPathKind = "bezier" | "clothoid";

interface UniformTrajectory {
  samples: UniformSample[];
  timeScale: number;
}

function wrapRadians(value: number): number {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function interpolateSample(samples: TrajectorySample[], timeS: number): TrajectorySample {
  if (timeS <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (timeS >= last.t) return last;

  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t < timeS) low = middle + 1;
    else high = middle;
  }

  const before = samples[low - 1];
  const after = samples[low];
  const fraction = (timeS - before.t) / Math.max(1e-9, after.t - before.t);
  const lerp = (a: number, b: number) => a + (b - a) * fraction;
  return {
    ...before,
    t: timeS,
    x: lerp(before.x, after.x),
    y: lerp(before.y, after.y),
    headingRad: before.headingRad + wrapRadians(after.headingRad - before.headingRad) * fraction,
    velocityMps: lerp(before.velocityMps, after.velocityMps),
    angularVelocityRadps: lerp(before.angularVelocityRadps, after.angularVelocityRadps),
  };
}

function uniformSamples(path: BdxPath, samplePeriodS: number): UniformTrajectory {
  const tickCount = Math.max(1, Math.ceil((path.totalTimeS - 1e-9) / samplePeriodS));
  if (tickCount + 1 > LABVIEW_BDX_MAX_TRAJECTORY_POINTS) {
    throw new Error(`Path "${path.name}" requires ${tickCount + 1} samples, exceeding the LabVIEW .bdx limit of ${LABVIEW_BDX_MAX_TRAJECTORY_POINTS}`);
  }
  const durationS = tickCount * samplePeriodS;
  const timeScale = path.totalTimeS > 1e-9 ? path.totalTimeS / durationS : 1;
  const count = tickCount + 1;
  const samples = Array.from({ length: count }, (_, index) => {
    const sample = interpolateSample(path.samples, Math.min(index * samplePeriodS * timeScale, path.totalTimeS));
    return {
      xFt: sample.x * FEET_PER_METER,
      yFt: sample.y * FEET_PER_METER,
      headingDeg: sample.headingRad * 180 / Math.PI,
      velocityFps: sample.velocityMps * timeScale * FEET_PER_METER,
      omegaDegps: sample.angularVelocityRadps * timeScale * 180 / Math.PI,
    };
  });
  return { samples, timeScale };
}

function velocityVector(samples: UniformSample[], index: number): { x: number; y: number } {
  const before = samples[Math.max(0, index - 1)];
  const after = samples[Math.min(samples.length - 1, index + 1)];
  const dx = after.xFt - before.xFt;
  const dy = after.yFt - before.yFt;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return { x: 0, y: 0 };
  return {
    x: samples[index].velocityFps * dx / length,
    // LabVIEW's velocity vector uses screen-space Y, opposite the path-position Y axis.
    y: -samples[index].velocityFps * dy / length,
  };
}

function profileIndices(samples: UniformSample[]): { accel: number; decel: number } {
  const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample.velocityFps)), 0);
  if (peak < 1e-9) return { accel: 0, decel: samples.length - 1 };
  const threshold = peak * 0.999;
  const accel = samples.findIndex((sample) => Math.abs(sample.velocityFps) >= threshold);
  let decel = samples.length; // LabVIEW uses the array length when no deceleration phase exists.
  if (Math.abs(samples.at(-1)!.velocityFps) < threshold) {
    decel = samples.length - 1;
    while (decel > 0 && Math.abs(samples[decel].velocityFps) < threshold) decel -= 1;
  }
  return { accel: Math.max(0, accel), decel };
}

function labviewPathKind(path: PathDoc, plannerId: BordeauxProject["plannerId"]): LabviewPathKind {
  if (path.labview?.trajectoryType === "bezier") return "bezier";
  if (path.labview?.trajectoryType === "clothoid") return "clothoid";
  if (plannerId === "labviewBezier") return "bezier";
  if (plannerId === "labviewClothoid") return "clothoid";
  const segmentTypes = path.waypoints.slice(0, -1).map((waypoint) => waypoint.segType ?? "bezier");
  if (segmentTypes.every((type) => type === "clothoid")) return "clothoid";
  if (segmentTypes.every((type) => type === "bezier")) return "bezier";
  throw new Error(`Path "${path.name}" mixes or uses unsupported segment types; LabVIEW Bordeaux paths must be entirely Bezier or entirely clothoid`);
}

function writeEmptyClothoidTerminator(writer: LabviewBinaryWriter): void {
  writer.string("");
  writer.u16(0);
  writer.u32(0);
  writer.u32(0);
  writer.i32(0);
  writer.i32(0);
}

function writeTrajectory(writer: LabviewBinaryWriter, path: BdxPath, kind: LabviewPathKind, samplePeriodS: number): { sampleCount: number } {
  const { samples } = uniformSamples(path, samplePeriodS);
  const indices = profileIndices(samples);
  const clothoid = kind === "clothoid";
  const straight = clothoid && path.samples.every((sample) => Math.abs(sample.curvatureInvM) < 1e-7);

  writer.u32(clothoid ? 2 : 1); // Rebuilt clothoid output retains an empty terminal cluster.
  writer.string(straight ? "Linear 0" : clothoid ? "Blend" : "Bezier");
  writer.u16(straight ? 0 : clothoid ? 2 : 4); // Segment Type: Accel Straight, Blend, or Bezier.

  writer.u32(samples.length);
  for (const sample of samples) {
    writer.f64(sample.xFt);
    writer.f64(sample.yFt);
    writer.f64(sample.headingDeg);
  }

  writer.u32(samples.length);
  samples.forEach((sample, index) => {
    const vector = velocityVector(samples, index);
    writer.f64(sample.velocityFps);
    writer.f64(sample.omegaDegps);
    writer.f64(vector.y); // LabVIEW Trajectory Data.ctl stores V vector as y, then x.
    writer.f64(vector.x);
  });
  writer.i32(indices.accel);
  writer.i32(indices.decel);
  if (clothoid) writeEmptyClothoidTerminator(writer);
  return { sampleCount: samples.length };
}

function writeLimits(writer: LabviewBinaryWriter, path: PathDoc, samplePeriodS: number, initialVelocityFps: number, finalVelocityFps: number): void {
  const constraints = path.constraints;
  writer.f64(samplePeriodS);
  writer.f64(constraints.maxVel * FEET_PER_METER);
  writer.f64(constraints.maxAccel * FEET_PER_METER);
  writer.f64((constraints.maxJerk ?? 0) * FEET_PER_METER);
  writer.f64((path.labview?.stoopidFastMps ?? constraints.maxVel) * FEET_PER_METER);
  writer.f64(initialVelocityFps);
  writer.f64(finalVelocityFps);
  writer.u32(0); // Per-waypoint overrides have no direct editor equivalent yet.
  writer.f64(constraints.maxAngVel);
  writer.f64(constraints.maxAngAccel);
  writer.f64(constraints.maxAngJerk ?? 0);
}

function writeWaypoints(writer: LabviewBinaryWriter, path: PathDoc): void {
  writer.u32(path.waypoints.length);
  for (const waypoint of path.waypoints) {
    writer.f64(waypoint.x * FEET_PER_METER);
    writer.f64(waypoint.y * FEET_PER_METER);
    writer.f64(waypoint.theta);
  }
}

export interface LabviewBdxResult {
  buffer: Buffer;
  pathName: string;
  samplePeriodS: number;
  sampleCount: number;
  version: typeof BDX_VERSION;
}

/** Encode the active path using the field order written by LabVIEW Bordeaux's Versioned Write.vi. */
export function buildLabviewBdx(project: BordeauxProject, pathId?: string): LabviewBdxResult {
  const source = pathId
    ? project.paths.find((path) => path.id === pathId && path.exportable !== false)
    : project.paths.find((path) => path.exportable !== false);
  if (!source) throw new Error(pathId ? "The selected path is not exportable" : "The project has no exportable paths");
  if (source.waypoints.slice(0, -1).some((waypoint) => (waypoint.segmentFollowMode ?? source.followMode ?? "time") === "position")) {
    throw new Error("LabVIEW .bdx cannot encode position-based following; use Java JSON or change every segment to Time");
  }
  if (source.waypoints.length > LABVIEW_BDX_MAX_WAYPOINTS) {
    throw new Error(`Path "${source.name}" has ${source.waypoints.length} waypoints, exceeding the LabVIEW .bdx limit of ${LABVIEW_BDX_MAX_WAYPOINTS}`);
  }
  const kind = labviewPathKind(source, project.plannerId);
  const configuredSamplePeriod = source.labview?.samplePeriodS;
  const samplePeriodS = Number.isFinite(configuredSamplePeriod) && configuredSamplePeriod! >= 0.001 && configuredSamplePeriod! <= 0.1
    ? configuredSamplePeriod!
    : DEFAULT_SAMPLE_PERIOD_S;
  const exportData = buildBdxExport({
    ...project,
    plannerId: source.labview?.trajectoryType
      ? (kind === "clothoid" ? "labviewClothoid" : "labviewBezier")
      : project.plannerId,
    paths: [source],
    routine: undefined,
  });
  const selected = exportData.paths[0];
  if (!selected) throw new Error("The selected path did not generate a trajectory");

  const writer = new LabviewBinaryWriter();
  writer.string(BDX_VERSION);
  writer.boolean(Boolean(source.driveBackward)); // Robot Backwards
  writer.boolean(Boolean(source.labview?.reversePath));
  const trajectory = writeTrajectory(writer, selected, kind, samplePeriodS);
  writer.u32(0); // Commands in
  const endpointVelocityLimit = Math.min(source.constraints.maxVel, project.robot.maxSpeed);
  const initialVelocityFps = (source.waypoints[0].stop ? 0 : Math.min(source.startVel, endpointVelocityLimit)) * FEET_PER_METER;
  const finalVelocityFps = (source.waypoints.at(-1)!.stop ? 0 : Math.min(source.goalVel, endpointVelocityLimit)) * FEET_PER_METER;
  writeLimits(writer, source, samplePeriodS, initialVelocityFps, finalVelocityFps);
  writeWaypoints(writer, source);
  writer.f64((trajectory.sampleCount - 1) * samplePeriodS);
  writer.f64(selected.totalDistanceM * FEET_PER_METER);
  writer.boolean(Boolean(source.labview?.zeroVelocity));
  writer.u16(project.robot.drive === "tank" ? 0 : 1); // Drive Type
  writer.u16(kind === "clothoid" ? 0 : 1); // Path Type
  writer.boolean(Boolean(source.labview?.pickupBalls));
  writer.f64(source.labview?.currentLimit ?? 0);
  writer.boolean(Boolean(source.labview?.zeroTranslationalVelocity));
  writer.boolean(Boolean(source.labview?.correctAtBeginningOfPath));

  return {
    buffer: writer.finish(),
    pathName: selected.name,
    samplePeriodS,
    sampleCount: trajectory.sampleCount,
    version: BDX_VERSION,
  };
}
