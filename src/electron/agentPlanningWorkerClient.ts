import path from "node:path";
import type { AgentPlanningRunner } from "./agentSession";
import { runWorkerTask } from "./workerTask";

export const runAgentPlanningInWorker: AgentPlanningRunner = (job, signal) =>
  runWorkerTask(path.join(__dirname, "agentPlanningWorker.js"), job, "Agent planning", signal);
