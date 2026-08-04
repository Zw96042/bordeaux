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
  | CommandArgumentValue[]
  | { [key: string]: CommandArgumentValue };

export interface CommandInvocation {
  commandId: string;
  arguments: Record<string, CommandArgumentValue>;
  cancelOnPathEnd?: boolean;
}

export type JavaValueSchemaKind =
  | "boolean"
  | "integer"
  | "integerString"
  | "decimalString"
  | "number"
  | "string"
  | "enum"
  | "array"
  | "map"
  | "optional"
  | "object"
  | "opaque";

export interface JavaValueField {
  name: string;
  schema: JavaValueSchema;
}

export interface JavaValueSchema {
  kind: JavaValueSchemaKind;
  javaType: string;
  enumValues?: string[];
  element?: JavaValueSchema;
  value?: JavaValueSchema;
  fields?: JavaValueField[];
}

export interface JavaCommandParameter {
  name: string;
  label?: string;
  description?: string;
  unit?: string;
  defaultValue?: CommandArgumentValue;
  min?: number | string;
  max?: number | string;
  javaType: string;
  role: "argument" | "dependency";
  schema: JavaValueSchema;
}

export interface JavaCommandDescriptor {
  id: string;
  label: string;
  description?: string;
  /** Team-authored natural-language aliases from the generated catalog. */
  aliases?: string[];
  /** Explicit capabilities such as shoot-fuel; never inferred from the label. */
  semanticTags?: string[];
  ownerType: string;
  member: string;
  kind: "constructor" | "factory";
  confidence: "confirmed" | "inferred";
  runtimeReady?: boolean;
  parameters: JavaCommandParameter[];
  source: {
    file: string;
    line: number;
  };
}

export interface JavaCommandCatalog {
  projectName: string;
  sourceFileCount: number;
  scannedAt: string;
  source?: "source" | "generated" | "mixed";
  runtimeCommandCount?: number;
  generatedSchemaVersion?: "1.0";
  catalogId?: string;
  supportVersion?: string;
  catalogHash?: string;
  authoritative?: boolean;
  commands: JavaCommandDescriptor[];
  warnings: string[];
}

export interface JavaProjectBookmarkSummary {
  id: string;
  projectName: string;
  folderName: string;
  lastLinkedAt: string;
}

export interface JavaProjectConnectionResult {
  catalog: JavaCommandCatalog;
  bookmarkId: string;
  recentProjects: JavaProjectBookmarkSummary[];
  integration: JavaIntegrationStatus;
  warning?: string;
}

export interface JavaIntegrationStatus {
  installed: boolean;
  supportVersion?: string;
  generatedCatalog: boolean;
  catalogHash?: string;
  buildFile: "build.gradle" | "build.gradle.kts";
  wrapperAvailable: boolean;
}

export interface ConstraintRange {
  anchor: "param" | "dist" | "wp";
  f0: number;
  f1: number;
  d0?: number;
  d1?: number;
