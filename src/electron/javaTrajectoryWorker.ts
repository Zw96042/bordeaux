import { parentPort } from "node:worker_threads";
import { buildJavaDeployment, compareJavaDeployment } from "../shared/export/javaDeployment";
import { buildJavaTrajectory } from "../shared/export/javaTrajectory";
import type { JavaTrajectoryJob, JavaTrajectoryResult } from "./javaTrajectoryProtocol";
import type { WorkerResult } from "./workerTask";

const port = parentPort;
if (!port) throw new Error("Java trajectory worker requires a parent port");

function execute(job: JavaTrajectoryJob): JavaTrajectoryResult {
  switch (job.kind) {
    case "trajectory":
      return { kind: job.kind, built: buildJavaTrajectory(job.project, job.catalog) };
    case "comparison":
      return { kind: job.kind, comparison: compareJavaDeployment(job.project, job.catalog, job.baselineContents) };
    case "deployment":
      return { kind: job.kind, deployment: buildJavaDeployment(job.project, job.catalog, job.scope, job.baselineContents) };
  }
}

port.once("message", (job: JavaTrajectoryJob) => {
  try {
    port.postMessage({ ok: true, result: execute(job) } satisfies WorkerResult<JavaTrajectoryResult>);
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResult<JavaTrajectoryResult>);
  }
});
