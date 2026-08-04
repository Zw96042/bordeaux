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
  f1: number;
  d0?: number;
  d1?: number;
  w0?: number;
  w1?: number;
  maxVel: number;
  maxAccel: number;
  maxDecel?: number;
  maxAngVel: number;
  maxAngAccel: number;
  name?: string;
}

export interface PathDoc {
  name: string;
  waypoints: Waypoint[];
  targets: RotationTarget[];
  markers: Marker[];
  ranges: ConstraintRange[];
  constraints: PathConstraints;
  headingMode?: "manual" | "tangent" | "targets";
  driveBackward?: boolean;
  startVel: number;
  goalVel: number;
  exportable?: boolean;
}

export interface PathConstraints {
  maxVel: number;
  maxAccel: number;
  maxDecel: number;
  maxAngVel: number;
  maxAngAccel: number;
  maxAngDecel?: number;
  maxJerk?: number;
  maxAngJerk?: number;
}

export interface RoutineFunctionNode {
  id: string;
  type: "function";
  cat: "terminate" | "sequence" | "generate" | "velocity";
  title?: string;
  trigger?: string;
  note?: string;
  scale?: number;
  funcRef?: string;
  op?: string;
  target?: string;
}

export interface RoutinePathNode {
  id: string;
  type: "path";
  ref: number;
}

export interface RoutineDecisionNode {
  id: string;
  type: "decision";
  cond: string;
  thenLabel: string;
  elseLabel: string;
  then: RoutineNode[];
  else: RoutineNode[];
}

export type RoutineNode = RoutineFunctionNode | RoutinePathNode | RoutineDecisionNode;

export interface AutonomousRoutine {
  name: string;
  nodes: RoutineNode[];
}

export interface BordeauxProject {
  schemaVersion: string;
  name: string;
  robot: RobotConfig;
  paths: PathDoc[];
  routine?: AutonomousRoutine;
  plannerId?: TrajectoryPlannerId;
}

export interface ProjectFile {
  path: string | null;
  project: BordeauxProject;
}

export interface SaveResult {
  path: string;
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
