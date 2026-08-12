import { describe, expect, it } from "vitest";
import { applyBrushDraft, remapBrushSelection, syncBrushSelection } from "../src/renderer/app/App";
import { PathEdit } from "../src/renderer/assets/path-edit";

function path() {
  return {
    id: "path_brush_test",
    waypoints: [
      { x: 1, y: 4, prevC: { x: 1, y: 4 }, nextC: { x: 2.5, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
      { x: 6, y: 4, prevC: { x: 4.5, y: 4 }, nextC: { x: 7.5, y: 4 }, linked: true, theta: 0, thetaOn: false, stop: false, segType: "bezier" },
      { x: 11, y: 4, prevC: { x: 9.5, y: 4 }, nextC: { x: 11, y: 4 }, linked: true, theta: 0, thetaOn: true, stop: false, segType: "bezier" },
    ],
    ranges: [],
  };
}

describe("brush edit lifecycle", () => {
  it("keeps an off-path sample idle and starts one draft when the same drag reaches the path", () => {
    const editStore = PathEdit.create();
    const source = path();
    let notifications = 0;
    editStore.subscribe(() => { notifications += 1; });

    const idle = applyBrushDraft(editStore, source, {
      kind: "push",
      previous: { x: 2, y: 7.5 },
      center: { x: 2.1, y: 7.5 },
      radius: 0.5,
      strength: 1,
    });

    expect(idle.changed).toBe(false);
    expect(editStore.getSnapshot()).toBeNull();
    expect(editStore.getCancelRevision()).toBe(0);
    expect(notifications).toBe(0);

    const changed = applyBrushDraft(editStore, source, {
      kind: "push",
      previous: { x: 3, y: 4 },
      center: { x: 3, y: 4.2 },
      radius: 1,
      strength: 1,
    });

    expect(changed.changed).toBe(true);
    expect(editStore.getSnapshot()).not.toBeNull();
    expect(notifications).toBe(1);
  });

  it("keeps a segment selection on its original endpoint after earlier subdivision", () => {
    const editStore = PathEdit.create();
    const result = applyBrushDraft(editStore, path(), {
      kind: "push",
      previous: { x: 3, y: 4 },
      center: { x: 3, y: 4.3 },
      radius: 1,
      strength: 1,
    });

    const selection = remapBrushSelection({ kind: "seg", idx: 1 }, result.beforeWaypoints, result.path.waypoints);
    expect(selection).toEqual({ kind: "seg", idx: expect.any(Number) });
    expect(selection.idx).toBeGreaterThan(1);
    expect(result.path.waypoints[selection.idx]).toBe(result.beforeWaypoints[1]);
  });

  it.each([
    { kind: "wp", idx: 2 },
    { kind: "seg", idx: 1 },
  ])("remaps a $kind selection through two synchronous brush samples", (initial) => {
    const editStore = PathEdit.create();
    const source = path();
    const tracked = { x: source.waypoints[initial.idx].x, y: source.waypoints[initial.idx].y };
    const selection = { current: initial };
    const selected = [];

    const first = applyBrushDraft(editStore, source, {
      kind: "push",
      previous: { x: 3, y: 4 },
      center: { x: 3, y: 4.3 },
      radius: 1,
      strength: 1,
    });
    syncBrushSelection(selection, first.beforeWaypoints, first.path.waypoints, (kind, idx) => selected.push({ kind, idx }));

    const second = applyBrushDraft(editStore, source, {
      kind: "push",
      previous: { x: 3, y: 4.3 },
      center: { x: 3.2, y: 4.4 },
      radius: 1,
      strength: 1,
    });
    syncBrushSelection(selection, second.beforeWaypoints, second.path.waypoints, (kind, idx) => selected.push({ kind, idx }));

    expect(selection.current.kind).toBe(initial.kind);
    expect(second.path.waypoints[selection.current.idx]).toMatchObject(tracked);
    expect(selected.at(-1)).toEqual(selection.current);
  });
});
