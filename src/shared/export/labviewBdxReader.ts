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
