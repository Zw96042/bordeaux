import type { BuiltJavaDeployment, JavaDeploymentComparison, RobotPushScope } from "../shared/export/javaDeployment";
import type { BuiltJavaTrajectory } from "../shared/export/javaTrajectory";
import type { BordeauxProject, JavaCommandCatalog } from "../shared/types";

type TrajectoryInput = { project: BordeauxProject; catalog: JavaCommandCatalog };

export type JavaTrajectoryJob = TrajectoryInput & (
  | { kind: "trajectory" }
  | { kind: "comparison"; baselineContents: string | null }
  | { kind: "deployment"; scope: RobotPushScope; baselineContents: string | null }
);

export type JavaTrajectoryResult =
  | { kind: "trajectory"; built: BuiltJavaTrajectory }
  | { kind: "comparison"; comparison: JavaDeploymentComparison }
  | { kind: "deployment"; deployment: BuiltJavaDeployment };
