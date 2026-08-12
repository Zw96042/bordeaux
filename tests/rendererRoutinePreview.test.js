import { describe, expect, it } from "vitest";
import { processRoutinePreviewJob } from "../src/renderer/assets/path-preview-worker";
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
  it("sends only paths referenced by the active routine", () => {
    const referenced = { id: "path_a" };
    const unrelated = { id: "path_b", payload: "large" };
    const routine = { nodes: [{ id: "decision", type: "decision", then: [{ id: "node_a", type: "path", ref: referenced.id }], else: [{ id: "node_b", type: "path", ref: unrelated.id }] }] };

    expect(routinePreview().referencedPaths(routine, [unrelated, referenced], { decision: "then" })).toEqual([referenced]);
  });

  it("counts unique path and routine assembly work before direct fallback", () => {
    const path = { id: "path_a" };
    const routine = { nodes: Array.from({ length: 100 }, (_, index) => ({ id: `node_${index}`, type: "path", ref: path.id })) };

    expect(routinePreview().directRoutineWork(routine, [path])).toBe(1 + 100 * 16 + 250);
  });

  it("rejects a huge repeated routine even when it references one cheap path", () => {
    const path = { id: "path_a" };
    const routine = { nodes: Array.from({ length: 100_000 }, (_, index) => ({ id: `node_${index}`, type: "path", ref: path.id })) };

    expect(routinePreview().directRoutineWork(routine, [path])).toBeGreaterThan(100_000);
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
