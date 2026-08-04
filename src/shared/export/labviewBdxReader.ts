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
