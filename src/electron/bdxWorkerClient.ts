import path from "node:path";
import type { BuiltRobotBinary } from "../shared/export/robotBinary";
import type { BdxJob } from "./bdxProtocol";
import { runWorkerTask } from "./workerTask";
export function buildBdxOffThread(job: BdxJob): Promise<BuiltRobotBinary> {
  return runWorkerTask(path.join(__dirname, "bdxWorker.js"), job, "BDX export");
}
