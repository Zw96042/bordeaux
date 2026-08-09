import { parentPort } from "node:worker_threads";
import { buildJavaTrajectory } from "../shared/export/javaTrajectory";
import type { BordeauxProject, JavaCommandCatalog } from "../shared/types";

if (!parentPort) throw new Error("Java trajectory worker requires a parent port");

parentPort.once("message", (value: { project: BordeauxProject; catalog: JavaCommandCatalog }) => {
  try {
    parentPort!.postMessage({ ok: true, built: buildJavaTrajectory(value.project, value.catalog) });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
