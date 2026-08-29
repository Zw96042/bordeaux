import { parentPort } from "node:worker_threads";
import { runAgentPlanningJobDirect, type AgentPlanningJob } from "./agentSession";

import type { WorkerResult } from "./workerTask";

const port = parentPort;
if (!port) throw new Error("Agent planning worker requires a parent port");

port.once("message", (job: AgentPlanningJob) => {
  void runAgentPlanningJobDirect(job).then(
    (result) => port.postMessage({ ok: true, result } satisfies WorkerResult<unknown>),
    (error) => port.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResult<unknown>),
  );
});
