import { parentPort } from "node:worker_threads";
import { buildRobotBinary, type BuiltRobotBinary } from "../shared/export/robotBinary";
import type { BdxJob } from "./bdxProtocol";
import type { WorkerResult } from "./workerTask";
const port = parentPort;
if (!port) throw new Error("BDX worker requires a parent port");
port.once("message", (job: BdxJob) => {
  try { port.postMessage({ ok: true, result: buildRobotBinary(job.project, job.selection, job.bindings) } satisfies WorkerResult<BuiltRobotBinary>); }
  catch (error) { port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResult<BuiltRobotBinary>); }
});
