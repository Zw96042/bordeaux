export type DriveType = "swerve" | "tank";

export type SegmentType = "bezier" | "line" | "arc" | "clothoid";
export type HeadingMode = "manual" | "tangent" | "targets";
export type SegmentHeadingMode = HeadingMode | "lookAt";

export interface ControlPoint {
  x: number;
  y: number;
}

export interface RobotConfig {
  drive: DriveType;
  w: number;
  l: number;
  /** Overall robot height. Omitted on migrated projects where it is unknown. */
  heightM?: number;
  /**
   * Convex bumper footprint in robot-local meters (+X forward, +Y left).
   * Omission preserves the centered rectangle defined by l and w.
   */
  footprint?: {
    kind: "polygon";
    verticesM: ControlPoint[];
  };
  /** Optional strategy-facing mechanism details used only by agent-assisted planning. */
  planning?: RobotPlanningProfile;
  maxSpeed: number;
}

export interface RobotIntakeProfile {
  /** Human-readable mechanism name, such as "Front intake". */
  name: string;
  /** Intake center in the robot-local frame (+X forward, +Y left). */
  centerM: ControlPoint;
  /** Outward collection direction relative to robot +X; front is 0 degrees. */
  directionDeg: number;
  /** Effective FUEL capture width at the intake opening. */
  captureWidthM: number;
  /** Fastest chassis speed the team trusts while collecting. */
  maxCollectSpeedMps: number;
}

export interface RobotShooterProfile {
  /** Direction the shooter fires relative to robot +X; front is 0 degrees. */
  directionDeg: number;
  /** Whether a shooting pose must orient this direction toward its target. */
  requiresTargetFacing: boolean;
  preferredRangeM?: number;
}

export interface RobotPlanningProfile {
  intake?: RobotIntakeProfile;
  shooter?: RobotShooterProfile;
  /** Team-authored constraints or strategy details not captured by structured fields. */
  notes?: string;
}

export interface TurnInPlace {
  headingDeg: number;
  direction?: "shortest" | "clockwise" | "counterclockwise";
}

export interface JiggleAction {
  distanceM: number;
  strokes: number;
  startDeg: number;
  stepDeg: number;
  /** Duration of one complete outbound-and-return stroke. */
  strokeTimeS: number;
}

export type HeadingTransitionPlacement = "before" | "split" | "after";

export interface HeadingTransition {
  /** Which adjacent segment provides distance for the heading-law blend. */
  placement?: HeadingTransitionPlacement;
  /** Whether heading or translation keeps its authored spatial schedule. */
  rotationPriority?: "heading" | "translation";
  /** Total path length available for the minimum-jerk blend. */
  distanceM?: number;
}

export interface Waypoint {
  x: number;
  y: number;
  theta: number;
  thetaOn: boolean;
  linked: boolean;
  stop: boolean;
  wait?: number;
  corner?: boolean;
  segType?: SegmentType;
  /** Heading law for the outgoing segment. Omitted to inherit PathDoc.headingMode. */
  segmentHeadingMode?: SegmentHeadingMode;
  /** Field point continuously faced by the outgoing segment when segmentHeadingMode is lookAt. */
  segmentLookAt?: ControlPoint;
  /** Continuity policy at the boundary into this waypoint's outgoing segment. */
  headingTransition?: HeadingTransition;
  /** Stationary angular move performed after arriving at this stopped waypoint. */
  turnInPlace?: TurnInPlace;
  /** Rapid terminal translation action expanded into samples without authored waypoints. */
  jiggle?: JiggleAction;
  prevC: ControlPoint;
  nextC: ControlPoint;
}

export interface RotationTarget {
  f: number;
  deg: number;
  anchor?: "param" | "dist";
  d?: number;
}

export interface Marker {
  id?: string;
  f: number;
  name: string;
  cmd?: string;
  invocation?: CommandInvocation;
  /** Requested endpoint action retained until an authoritative command is bound. */
  actionIntent?: {
    semanticTag: string;
    description: string;
  };
  group?: "sequential" | "parallel" | "deadline";
  anchor?: "param" | "dist";
  d?: number;
}

export type CommandArgumentValue =
  | null
  | boolean
  | number
  | string
  canceled?: boolean;
}

export interface ExportResult {
  path: string;
  export: BdxExport;
  canceled?: boolean;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type TrajectoryPlannerId = "profiledSpline" | "optimizedTrajectory";

export interface PlannerInput {
  path: PathDoc;
  robot: RobotConfig;
  plannerId?: TrajectoryPlannerId;
  samplesPerSegment?: number;
  smoothingPasses?: number;
}

export interface TrajectorySample {
  i: number;
  t: number;
  s: number;
  f: number;
  x: number;
  y: number;
  headingRad: number;
  velocityMps: number;
  accelerationMps2: number;
  angularVelocityRadps: number;
  curvatureInvM: number;
}

export interface BdxMarker {
  name: string;
  command: string | null;
  group: string | null;
  timeS: number;
  fraction: number;
}

export interface BdxPath {
  name: string;
  planner: TrajectoryPlannerId;
  totalTimeS: number;
  totalDistanceM: number;
  samples: TrajectorySample[];
  markers: BdxMarker[];
  diagnostics: ValidationIssue[];
  optimization?: PlannerOptimizationDiagnostics;
}

export interface PlannerResult {
  planner: TrajectoryPlannerId;
  totalTimeS: number;
  totalDistanceM: number;
  samples: TrajectorySample[];
  markers: BdxMarker[];
  diagnostics: ValidationIssue[];
  optimization?: PlannerOptimizationDiagnostics;
}

export interface TrajectoryPlanner {
  id: TrajectoryPlannerId;
  generate(input: PlannerInput): PlannerResult;
}

export interface PlannerOptimizationDiagnostics {
  plannerUsed: TrajectoryPlannerId;
  solveTimeMs: number;
  totalTimeS: number;
  maxVelocityMps: number;
  maxAccelerationMps2: number;
  constraintViolations: number;
  fallback: boolean;
  fallbackReason?: string;
}

export interface BdxExport {
  schemaVersion: string;
  generator: "bordeaux";
  units: {
    distance: "meters";
    time: "seconds";
    angle: "radians";
    velocity: "meters_per_second";
    acceleration: "meters_per_second_squared";
  };
  robot: {
    drive: DriveType;
    widthM: number;
    lengthM: number;
    maxSpeedMps: number;
  };
  paths: BdxPath[];
}

export interface ExportPreview {
  ok: boolean;
  pathCount: number;
  sampleCount: number;
  totalTimeS: number;
  issues: ValidationIssue[];
}
