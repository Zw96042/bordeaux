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
