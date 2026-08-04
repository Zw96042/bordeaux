export const LABVIEW_BDX_VERSION = "4.4" as const;

export type LabviewSegmentType =
  | "accelStraight"
  | "constantStraight"
  | "blend"
  | "circle"
  | "bezier";

export type LabviewDriveType = "nonholonomic" | "holonomic";
export type LabviewPathType = "clothoid" | "bezier";

export interface LabviewTrajectoryPosition {
  xFt: number;
  yFt: number;
  headingDeg: number;
}

export interface LabviewTrajectoryVelocity {
  velocityFps: number;
  omegaDegPerS: number;
  vectorYFps: number;
  vectorXFps: number;
}

export interface LabviewTrajectorySegment {
  name: string;
  typeCode: 0 | 1 | 2 | 3 | 4;
  type: LabviewSegmentType;
  positions: LabviewTrajectoryPosition[];
  velocities: LabviewTrajectoryVelocity[];
  accelIndex: number;
  decelIndex: number;
}

export interface LabviewLinearLimits {
  velocityFps: number;
  accelerationFps2: number;
  jerkFps3: number;
  stoopidFastFps: number;
}

export interface LabviewAngularLimits {
  velocityDegPerS: number;
  accelerationDegPerS2: number;
  jerkDegPerS3: number;
}

export interface LabviewBdxConditions {
  samplePeriodS: number;
  limits: LabviewLinearLimits;
  initialVelocityFps: number;
  finalVelocityFps: number;
  overrides: [];
  angularLimits: LabviewAngularLimits;
}

export interface LabviewWaypoint {
  xFt: number;
  yFt: number;
  thetaDeg: number;
}

export interface LabviewBdxV44 {
  version: typeof LABVIEW_BDX_VERSION;
  robotBackwards: boolean;
  reversePath: boolean;
  trajectory: LabviewTrajectorySegment[];
  commands: [];
  conditions: LabviewBdxConditions;
  updatedWaypoints: LabviewWaypoint[];
  timeS: number;
  distanceFt: number;
  zeroVelocity: boolean;
  driveTypeCode: 0 | 1;
  driveType: LabviewDriveType;
  pathTypeCode: 0 | 1;
  pathType: LabviewPathType;
  pickupBalls: boolean;
  currentLimit: number;
  zeroTranslationalVelocity: boolean;
  correctAtBeginningOfPath: boolean;
}

export class LabviewBdxParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (byte ${offset})`);
    this.name = "LabviewBdxParseError";
    this.offset = offset;
  }
}

export class LabviewBdxUnsupportedError extends LabviewBdxParseError {
  constructor(message: string, offset: number) {
    super(message, offset);
    this.name = "LabviewBdxUnsupportedError";
  }
}

const SEGMENT_TYPES: Record<0 | 1 | 2 | 3 | 4, LabviewSegmentType> = {
  0: "accelStraight",
  1: "constantStraight",
  2: "blend",
  3: "circle",
  4: "bezier",
};

export const LABVIEW_BDX_MAX_BYTES = 64 * 1024 * 1024;
export const LABVIEW_BDX_MAX_TRAJECTORY_POINTS = 250_000;
export const LABVIEW_BDX_MAX_WAYPOINTS = 100_000;
const MAX_STRING_BYTES = 1024 * 1024;
const MAX_TRAJECTORY_SEGMENTS = 1024;

class LabviewBinaryReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private position = 0;

  constructor(input: Uint8Array) {
    if (input.byteLength > LABVIEW_BDX_MAX_BYTES) {
      throw new LabviewBdxParseError(
        `File size ${input.byteLength} exceeds the supported ${LABVIEW_BDX_MAX_BYTES}-byte limit`,
        0,
      );
    }
    this.bytes = input;
    this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  }

  get offset(): number {
    return this.position;
  }

  get remaining(): number {
    return this.bytes.byteLength - this.position;
  }

  private require(size: number, label: string): void {
    if (this.remaining < size) {
      throw new LabviewBdxParseError(
        `Truncated ${label}: expected ${size} byte${size === 1 ? "" : "s"}, found ${this.remaining}`,
        this.position,
      );
    }
  }

  boolean(label: string): boolean {
    this.require(1, label);
    const offset = this.position;
    const value = this.view.getUint8(this.position++);
    if (value !== 0 && value !== 1) {
      throw new LabviewBdxParseError(`${label} must be encoded as 00 or 01, found ${value}`, offset);
    }
    return value === 1;
  }

  u16(label: string): number {
    this.require(2, label);
    const value = this.view.getUint16(this.position, false);
    this.position += 2;
    return value;
  }

  i32(label: string): number {
    this.require(4, label);
    const value = this.view.getInt32(this.position, false);
    this.position += 4;
    return value;
  }

  u32(label: string): number {
    this.require(4, label);
    const value = this.view.getUint32(this.position, false);
    this.position += 4;
    return value;
  }

  f64(label: string): number {
    this.require(8, label);
    const offset = this.position;
    const value = this.view.getFloat64(this.position, false);
    this.position += 8;
    if (!Number.isFinite(value)) {
      throw new LabviewBdxParseError(`${label} must be finite`, offset);
    }
    return value;
  }

  string(label: string): string {
    const lengthOffset = this.position;
    const length = this.u32(`${label} length`);
    if (length > MAX_STRING_BYTES) {
      throw new LabviewBdxParseError(
        `${label} length ${length} exceeds the supported ${MAX_STRING_BYTES}-byte limit`,
        lengthOffset,
      );
    }
    this.require(length, label);
    const value = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      throw new LabviewBdxParseError(`${label} is not valid UTF-8`, lengthOffset + 4);
    }
  }

  count(label: string, minimumElementSize: number, maximumCount: number): number {
    const countOffset = this.position;
    const count = this.u32(`${label} count`);
    if (count > maximumCount) {
      throw new LabviewBdxParseError(
        `${label} count ${count} exceeds the supported limit of ${maximumCount}`,
        countOffset,
      );
    }
    const maximumPossible = Math.floor(this.remaining / minimumElementSize);
    if (count > maximumPossible) {
      throw new LabviewBdxParseError(
        `${label} count ${count} exceeds the remaining data capacity (${maximumPossible})`,
        countOffset,
      );
    }
    return count;
  }

  requireEnd(): void {
    if (this.remaining !== 0) {
      throw new LabviewBdxParseError(`Unexpected ${this.remaining} trailing byte${this.remaining === 1 ? "" : "s"}`, this.position);
    }
  }
}

function readSegmentType(reader: LabviewBinaryReader): { code: 0 | 1 | 2 | 3 | 4; type: LabviewSegmentType } {
  const offset = reader.offset;
  const code = reader.u16("trajectory segment type");
  if (code < 0 || code > 4) {
    throw new LabviewBdxParseError(`Unknown trajectory segment type ${code}`, offset);
  }
  const typedCode = code as 0 | 1 | 2 | 3 | 4;
  return { code: typedCode, type: SEGMENT_TYPES[typedCode] };
}

function readTrajectorySegment(reader: LabviewBinaryReader): LabviewTrajectorySegment {
  const name = reader.string("trajectory segment name");
  const segmentType = readSegmentType(reader);
  const positionCount = reader.count("trajectory position array", 24, LABVIEW_BDX_MAX_TRAJECTORY_POINTS);
  const positions = Array.from({ length: positionCount }, () => ({
    xFt: reader.f64("trajectory position x"),
    yFt: reader.f64("trajectory position y"),
    headingDeg: reader.f64("trajectory position heading"),
  }));
  const velocityCount = reader.count("trajectory velocity array", 32, LABVIEW_BDX_MAX_TRAJECTORY_POINTS);
  const velocities = Array.from({ length: velocityCount }, () => ({
    velocityFps: reader.f64("trajectory velocity"),
    omegaDegPerS: reader.f64("trajectory omega"),
    // Trajectory Data.ctl defines the velocity-vector cluster as y, then x.
    vectorYFps: reader.f64("trajectory velocity vector y"),
    vectorXFps: reader.f64("trajectory velocity vector x"),
  }));
  const accelIndex = reader.i32("trajectory acceleration index");
  const decelIndex = reader.i32("trajectory deceleration index");
  return { name, typeCode: segmentType.code, type: segmentType.type, positions, velocities, accelIndex, decelIndex };
}

function readConditions(reader: LabviewBinaryReader): LabviewBdxConditions {
  const samplePeriodS = reader.f64("sample period");
  const limits = {
    velocityFps: reader.f64("linear velocity limit"),
    accelerationFps2: reader.f64("linear acceleration limit"),
    jerkFps3: reader.f64("linear jerk limit"),
    stoopidFastFps: reader.f64("StoopidFast velocity limit"),
  };
  const initialVelocityFps = reader.f64("initial velocity");
  const finalVelocityFps = reader.f64("final velocity");
  const overrideOffset = reader.offset;
  const overrideCount = reader.u32("override count");
  if (overrideCount !== 0) {
    throw new LabviewBdxUnsupportedError(
      `Non-empty LabVIEW Bordeaux overrides are not supported (found ${overrideCount})`,
      overrideOffset,
    );
  }
  const angularLimits = {
    velocityDegPerS: reader.f64("angular velocity limit"),
    accelerationDegPerS2: reader.f64("angular acceleration limit"),
    jerkDegPerS3: reader.f64("angular jerk limit"),
  };
  return {
    samplePeriodS,
    limits,
    initialVelocityFps,
    finalVelocityFps,
    overrides: [],
    angularLimits,
  };
}

function readDriveType(reader: LabviewBinaryReader): { code: 0 | 1; type: LabviewDriveType } {
  const offset = reader.offset;
  const code = reader.u16("drive type");
  if (code !== 0 && code !== 1) throw new LabviewBdxParseError(`Unknown drive type ${code}`, offset);
  return { code, type: code === 0 ? "nonholonomic" : "holonomic" };
}

function readPathType(reader: LabviewBinaryReader): { code: 0 | 1; type: LabviewPathType } {
  const offset = reader.offset;
  const code = reader.u16("path type");
  if (code !== 0 && code !== 1) throw new LabviewBdxParseError(`Unknown path type ${code}`, offset);
  return { code, type: code === 0 ? "clothoid" : "bezier" };
}

/**
 * Parse the raw big-endian flattened stream emitted by Bordeaux Versioned Write.vi v4.4.
 *
 * Historical versions are deliberately rejected: the recovered v3.1 files confirm the
 * framing convention, but their complete field schema has not been proven. Non-empty
 * commands and overrides are likewise rejected instead of guessing at LabVIEW Variant data.
 * This import boundary also rejects non-finite DBLs and non-canonical Boolean bytes even
 * though the underlying LabVIEW scalar representation can express them.
 */
export function parseLabviewBdx(input: Uint8Array): LabviewBdxV44 {
  const reader = new LabviewBinaryReader(input);
  const version = reader.string("Bordeaux version");
  if (version !== LABVIEW_BDX_VERSION) {
    throw new LabviewBdxUnsupportedError(
      `Unsupported LabVIEW Bordeaux .bdx version ${JSON.stringify(version)}; only v4.4 has a proven complete schema`,
      0,
    );
  }

  const robotBackwards = reader.boolean("Robot Backwards");
  const reversePath = reader.boolean("Reverse Path");
  const trajectoryCount = reader.count("trajectory array", 22, MAX_TRAJECTORY_SEGMENTS);
  const trajectory = Array.from({ length: trajectoryCount }, () => readTrajectorySegment(reader));

  const commandOffset = reader.offset;
  const commandCount = reader.u32("command count");
  if (commandCount !== 0) {
    throw new LabviewBdxUnsupportedError(
      `Non-empty LabVIEW Bordeaux commands are not supported (found ${commandCount}); command records contain LabVIEW Variant and Path values`,
      commandOffset,
    );
  }

  const conditions = readConditions(reader);
  const waypointCount = reader.count("updated waypoint array", 24, LABVIEW_BDX_MAX_WAYPOINTS);
  const updatedWaypoints = Array.from({ length: waypointCount }, () => ({
    xFt: reader.f64("waypoint x"),
    yFt: reader.f64("waypoint y"),
    thetaDeg: reader.f64("waypoint theta"),
  }));
  const timeS = reader.f64("path time");
  const distanceFt = reader.f64("path distance");
  const zeroVelocity = reader.boolean("Zero Velocity");
  const drive = readDriveType(reader);
  const path = readPathType(reader);
  const pickupBalls = reader.boolean("Pickup Balls");
