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

