import { parentPort } from "node:worker_threads";
import { buildJavaTrajectory } from "../shared/export/javaTrajectory";
import type { BordeauxProject, JavaCommandCatalog } from "../shared/types";

if (!parentPort) throw new Error("Java trajectory worker requires a parent port");

port.once("message", (job: JavaTrajectoryJob) => {
  try {
    port.postMessage({ ok: true, result: execute(job) } satisfies WorkerResult<JavaTrajectoryResult>);
  } catch (error) {
    port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResult<JavaTrajectoryResult>);
  }
});
