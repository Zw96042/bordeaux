import path from "node:path";
import { Worker } from "node:worker_threads";
import type { AgentPlanningJob, AgentPlanningRunner } from "./agentSession";

export const runAgentPlanningInWorker: AgentPlanningRunner = (job: AgentPlanningJob, signal?: AbortSignal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error("Agent planning was canceled.")); return; }
  const worker = new Worker(path.join(__dirname, "agentPlanningWorker.js"));
  let settled = false;
  const finish = (error?: Error, result?: unknown) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", cancel);
