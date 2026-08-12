import { describe, expect, it } from "vitest";
import { processRoutinePreviewJob } from "../src/renderer/assets/routine-preview-worker";
import { loadRendererExport } from "./helpers/loadRendererExport";

function routinePreview() {
  return loadRendererExport(new URL("../src/renderer/assets/routine-preview.js", import.meta.url), "RoutinePreview", {
    context: {
      AUTO: { walk(nodes, visit) { nodes.forEach(visit); } },
      PathPreview: { directPreviewWork: () => 250 },
    },
  });
}

describe("routine preview worker", () => {
  it("counts unique path work when deciding whether direct fallback is safe", () => {
    const path = { id: "path_a" };
    const routine = { nodes: Array.from({ length: 100 }, (_, index) => ({ id: `node_${index}`, type: "path", ref: path.id })) };

    expect(routinePreview().directRoutineWork(routine, [path])).toBe(250);
  });

  it("returns a routine run without changing worker response contracts", () => {
    const buildRun = () => ({ steps: [{ node: { id: "path" }, t0: 0, t1: 2 }], segs: [], total: 2 });

    expect(processRoutinePreviewJob({ id: 17 }, buildRun)).toMatchObject({
      id: 17,
      value: { total: 2 },
      durationMs: expect.any(Number),
    });
  });

  it("serializes worker failures", () => {
    const result = processRoutinePreviewJob({ id: 18 }, () => { throw new Error("bad routine"); });

    expect(result).toMatchObject({ id: 18, error: { name: "Error", message: "bad routine" } });
  });
});
