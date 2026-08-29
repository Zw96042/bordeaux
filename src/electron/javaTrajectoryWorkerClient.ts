import path from "node:path";
import type { RobotPushScope } from "../shared/export/javaDeployment";
import type { BordeauxProject, JavaCommandCatalog } from "../shared/types";
import type { JavaTrajectoryJob, JavaTrajectoryResult } from "./javaTrajectoryProtocol";
import { runWorkerTask } from "./workerTask";

function run(job: JavaTrajectoryJob): Promise<JavaTrajectoryResult> {
  return runWorkerTask(path.join(__dirname, "javaTrajectoryWorker.js"), job, "Java trajectory");
}

export async function buildJavaTrajectoryOffThread(project: BordeauxProject, catalog: JavaCommandCatalog) {
  const result = await run({ kind: "trajectory", project, catalog });
  if (result.kind !== "trajectory") throw new Error("Java trajectory worker returned an unexpected result kind");
  return result.built;
}

export async function compareJavaDeploymentOffThread(project: BordeauxProject, catalog: JavaCommandCatalog, baselineContents: string | null) {
  const result = await run({ kind: "comparison", project, catalog, baselineContents });
  if (result.kind !== "comparison") throw new Error("Java trajectory worker returned an unexpected result kind");
  return result.comparison;
}

export async function buildJavaDeploymentOffThread(project: BordeauxProject, catalog: JavaCommandCatalog, scope: RobotPushScope, baselineContents: string | null) {
  const result = await run({ kind: "deployment", project, catalog, scope, baselineContents });
  if (result.kind !== "deployment") throw new Error("Java trajectory worker returned an unexpected result kind");
  return result.deployment;
}
