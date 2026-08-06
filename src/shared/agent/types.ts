import type {
  BordeauxProject,
  PathDoc,
  PlannerOptimizationDiagnostics,
  RobotPlanningProfile,
  TrajectoryPlannerId,
  TrajectorySample,
  ValidationIssue,
} from "../types";

export type AllianceColor = "blue" | "red";

export interface AgentSessionSnapshot {
  sessionId: string;
  revision: number;
  project: BordeauxProject;
  plannerId: TrajectoryPlannerId;
  activePathId: string;
  allianceView: AllianceColor;
  fieldPack: {
    id: "2026-rebuilt";
    revision: string;
  };
}

export interface PathSampleReference {
  index: number;
  timeS: number;
  distanceM: number;
  fraction: number;
  x: number;
  y: number;
  physicalHeadingRad: number;
  segmentIndex: number;
  nearestWaypointIndex: number;
}

export type PathAnalysisMetric =
  | "velocity"
  | "acceleration"
  | "deceleration"
  | "angularVelocity"
  | "angularAcceleration"
  | "angularDeceleration"
  | "jerk"
  | "angularJerk"
  | "curvature";

export interface PathAnalysisExtremum {
  metric: PathAnalysisMetric;
  value: number;
  unit: string;
  sample: PathSampleReference;
}

export interface PathAnalysisFinding {
  id: string;
  severity: ValidationIssue["severity"] | "note";
  kind: "structure" | "planner" | "constraint" | "geometry";
  message: string;
  metric?: PathAnalysisMetric;
  measured?: number;
  limit?: number;
  unit?: string;
  sample?: PathSampleReference;
  sourcePath: string;
}

export interface PathAnalysis {
  pathId: string;
  pathName: string;
  authoredPath: PathDoc;
  planner: TrajectoryPlannerId;
  totalTimeS: number | null;
  totalDistanceM: number | null;
  sampleCount: number;
  samplesTruncated: boolean;
  rawSamples: TrajectorySample[];
  extrema: PathAnalysisExtremum[];
  findings: PathAnalysisFinding[];
  plannerDiagnostics: ValidationIssue[];
  optimization?: PlannerOptimizationDiagnostics;
}

export interface FieldPointInput {
  x: number;
  y: number;
  headingDeg?: number;
}

export interface FieldTermInput {
  term: string;
}

export type RouteLocationInput = FieldPointInput | FieldTermInput;

export type RouteTraversal = "direct" | "trench-table" | "trench-away" | "bump-table" | "bump-away";

export interface FuelCollectionIntent {
  /** Maximum permitted intake-to-travel angular error. Default 5 degrees. */
  maxHeadingErrorDeg?: number;
  /** Explicitly permit a non-aligned strategy for this route portion. */
  allowCrosswiseHeading?: boolean;
}

export type RouteStep =
  | {
      kind: "travel";
      to: RouteLocationInput;
      /** Crossing required on this leg, in physical table/away terms. */
      traversal?: RouteTraversal;
      collectFuel?: FuelCollectionIntent;
    }
  | {
      kind: "swoosh";
      /** Far longitudinal extent of a deterministic 180-degree smooth reversal. */
      at: RouteLocationInput;
      traversal?: RouteTraversal;
      turn: "clockwise" | "counterclockwise";
      radiusM: number;
      /** Moves the maneuver back along its approach from a named boundary. */
      insetM?: number;
      collectFuel?: FuelCollectionIntent;
    };

export interface PlanPathRequest {
  intent: string;
  name?: string;
  alliance: AllianceColor;
  start?: RouteLocationInput;
  /** Legacy simple route input. Use steps whenever route legs have different crossings or a named maneuver. */
  goals?: RouteLocationInput[];
  /** Ordered route contract. Bordeaux validates these crossings and maneuvers in sequence. */
  steps?: RouteStep[];
  traversal?: "fastest" | "trench" | "bump" | "compare";
  minimumClearanceM?: number;
  maximumCandidates?: number;
  nearTieWindowS?: number;
  basePathId?: string;
  /** Fallback for migrated projects without robot.heightM; configured project height wins. */
  robotHeightM?: number;
  /** Resolve a mechanism-aware physical heading at the final pose. */
  finishFacing?: {
    mechanism: "shooter";
    target: RouteLocationInput;
    maxHeadingErrorDeg?: number;
  };
  /** Legacy-goals shorthand: treat the complete route as a collection span. */
  collectFuel?: FuelCollectionIntent;
  endAction?: {
    commandId: string;
    semanticTag: string;
    arguments?: Record<string, import("../types").CommandArgumentValue>;
    cancelOnPathEnd?: boolean;
  };
  /** Preserve a requested action when no authoritative Java binding is available yet. */
  endActionIntent?: {
    semanticTag: string;
    description: string;
  };
}

export interface RouteCandidateMetrics {
  totalTimeS: number;
  totalDistanceM: number;
  minimumClearanceM: number;
  waypointCount: number;
  peakCurvatureInvM: number;
  peakAngularVelocityRadps: number;
  /** Approximate unique intake swath coverage; retracing the same cells is counted once. */
  estimatedCollectionAreaM2?: number;
  shootingRangeM?: number;
  preferredShootingRangeErrorM?: number;
}

export interface RouteCandidate {
  id: string;
  label: string;
  traversal: RouteTraversal | "ordered";
  requiredPortalIds?: string[];
