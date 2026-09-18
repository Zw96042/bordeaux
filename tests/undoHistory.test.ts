import { describe, expect, it } from "vitest";
import {
  PROJECT_SCOPE, ROUTINE_SCOPE, UNDO_LIMIT, applicableIndex, captureProjectChange,
  createUndoHistory, linkedPathIds, pathScope, restoreProjectChange, undoScopes,
} from "../src/renderer/lib/undoHistory";

type Entry = { scope: string; touches: string[]; label: string };
const entry = (scope: string, label: string, touches = [scope]): Entry => ({ scope, touches, label });
const plan = (id: string) => undoScopes("plan", id);
const auto = undoScopes("auto", "p1");

/** Applies an entry by recording it; the inverse carries the same identity for redo. */
function journal() {
  const history = createUndoHistory<Entry>();
  const applied: string[] = [];
  const apply = (item: Entry) => { applied.push(item.label); return { ...item, label: item.label }; };
  return { history, applied, undo: (scopes: string[]) => history.undo(scopes, apply), redo: (scopes: string[]) => history.redo(scopes, apply) };
}

describe("undo scopes", () => {
  it("scopes each surface to its own history plus project changes", () => {
    expect(undoScopes("plan", "p1")).toEqual([pathScope("p1"), PROJECT_SCOPE]);
    expect(undoScopes("auto", "p1")).toEqual([ROUTINE_SCOPE, PROJECT_SCOPE]);
    expect(undoScopes("robot", "p1")).toEqual([PROJECT_SCOPE]);
  });
});

describe("undo journal", () => {
  it("leaves an earlier routine edit intact after undoing a later path edit twice", () => {
    const { history, applied, undo } = journal();
    history.record(entry(ROUTINE_SCOPE, "routine edit"));
    history.record(entry(pathScope("p1"), "path edit"));

    expect(undo(plan("p1"))).toBe(true);
    expect(undo(plan("p1"))).toBe(false);
    expect(applied).toEqual(["path edit"]);
    expect(history.canUndo(auto)).toBe(true);
    expect(undo(auto)).toBe(true);
    expect(applied).toEqual(["path edit", "routine edit"]);
  });

  it("undoes a newer project change before older path edits, and redoes symmetrically", () => {
    const { history, applied, undo, redo } = journal();
    history.record(entry(pathScope("p1"), "path edit 1"));
    history.record(entry(pathScope("p1"), "path edit 2"));
    history.record(entry(PROJECT_SCOPE, "delete p2", [pathScope("p2"), "pathLinks"]));

    expect(undo(plan("p1"))).toBe(true);
    expect(undo(plan("p1"))).toBe(true);
    expect(applied).toEqual(["delete p2", "path edit 2"]);
    expect(redo(plan("p1"))).toBe(true);
    expect(redo(plan("p1"))).toBe(true);
    expect(redo(plan("p1"))).toBe(false);
    expect(applied).toEqual(["delete p2", "path edit 2", "path edit 2", "delete p2"]);
    expect(history.size).toEqual({ past: 3, future: 0 });
  });

  it("undoes a newer path edit before an older project change", () => {
    const { history, applied, undo } = journal();
    history.record(entry(PROJECT_SCOPE, "apply proposal", [pathScope("p1")]));
    history.record(entry(pathScope("p1"), "path edit"));

    undo(plan("p1")); undo(plan("p1"));
    expect(applied).toEqual(["path edit", "apply proposal"]);
  });

  it("refuses to jump over a newer edit on another surface that touched the same state", () => {
    const { history, applied, undo } = journal();
    history.record(entry(PROJECT_SCOPE, "replace p2", [pathScope("p2")]));
    history.record(entry(pathScope("p2"), "edit p2"));

    expect(history.canUndo(plan("p1"))).toBe(false);
    expect(undo(plan("p1"))).toBe(false);
    expect(applied).toEqual([]);
    expect(undo(plan("p2"))).toBe(true);
    expect(undo(plan("p1"))).toBe(true);
    expect(applied).toEqual(["edit p2", "replace p2"]);
  });

  it("skips unrelated newer entries from other surfaces", () => {
    const { history, applied, undo } = journal();
    history.record(entry(PROJECT_SCOPE, "delete p3", [pathScope("p3")]));
    history.record(entry(ROUTINE_SCOPE, "routine edit"));
    history.record(entry(pathScope("p2"), "edit p2"));

    expect(applicableIndex([...Array(0)], plan("p1"))).toBe(-1);
    expect(undo(plan("p1"))).toBe(true);
    expect(applied).toEqual(["delete p3"]);
    expect(history.size).toEqual({ past: 2, future: 1 });
  });

  it("keeps a refused entry in place", () => {
    const history = createUndoHistory<Entry>();
    history.record(entry(pathScope("p1"), "path edit"));
    expect(history.undo(plan("p1"), () => null)).toBe(false);
    expect(history.size).toEqual({ past: 1, future: 0 });
  });

  it("clears redo on a new change and keeps the existing history cap", () => {
    const { history, undo } = journal();
    for (let index = 0; index < UNDO_LIMIT + 5; index += 1) history.record(entry(pathScope("p1"), "edit " + index));
    expect(history.size.past).toBe(UNDO_LIMIT);
    undo(plan("p1"));
    expect(history.canRedo(plan("p1"))).toBe(true);
    history.record(entry(ROUTINE_SCOPE, "routine edit"));
    expect(history.canRedo(plan("p1"))).toBe(false);
    history.clear();
    expect(history.size).toEqual({ past: 0, future: 0 });
  });
});

describe("linked path touches", () => {
  it("follows endpoint links and shared positions transitively", () => {
    const project = {
      paths: [
        { id: "a", waypoints: [{}, { positionLink: "shared" }] },
        { id: "b", waypoints: [{ positionLink: "shared" }, {}] },
        { id: "c", waypoints: [{}, {}] },
        { id: "d", waypoints: [{}, {}] },
      ],
      pathLinks: [{ fromPathId: "b", toPathId: "c" }],
    };
    expect(linkedPathIds(project, "a").sort()).toEqual(["a", "b", "c"]);
    expect(linkedPathIds(project, "d")).toEqual(["d"]);
    expect(linkedPathIds(project, ["a", "d"]).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("project change snapshots", () => {
  type Path = { id: string; name: string; folderId?: string; waypoints: { positionLink?: string }[] };
  const path = (id: string, name: string, extra: Partial<Path> = {}): Path => ({ id, name, waypoints: [{}, {}], ...extra });
  const p1 = path("p1", "One"), p2 = path("p2", "Two", { folderId: "f" }), p3 = path("p3", "Three");
  const base = { name: "Project", paths: [p1, p2, p3], pathLinks: [{ fromPathId: "p1", toPathId: "p2" }], pathFolders: [{ id: "f" }], robot: { planning: { a: 1 } } };

  it("restores a deleted path at its index with its links, leaving later unrelated edits intact", () => {
    const deleted = { ...base, paths: [p1, p3], pathLinks: [] };
    const { touches, change } = captureProjectChange(base, deleted, "p2");
    // The removed link's other endpoint is a dependency of the deletion.
    expect(touches.sort()).toEqual(["path:p1", "path:p2"]);
    const editedP3 = { ...p3, waypoints: [{}, {}, {}] };
    const later = { ...deleted, paths: [p1, editedP3] };

    const restored = restoreProjectChange(later, change);
    expect(restored.paths).toEqual([p1, p2, editedP3]);
    expect(restored.pathLinks).toEqual(base.pathLinks);
    expect(change.activePathId).toBe("p2");

    const redo = captureProjectChange(later, restored, "p2");
    const again = restoreProjectChange(restored, redo.change);
    expect(again.paths).toEqual([p1, editedP3]);
    expect(again.pathLinks).toEqual([]);
  });

  it("restores robot planning only when it changed", () => {
    const configured = { ...base, robot: { planning: { a: 2 } } };
    const { touches, change } = captureProjectChange(base, configured, null);
    expect(touches).toEqual(["robot.planning"]);
    expect(change.paths).toEqual([]);
    expect(change.links).toBeNull();
    const restored = restoreProjectChange(configured, change);
    expect(restored.robot.planning).toEqual({ a: 1 });
    expect(restored.pathFolders).toBe(base.pathFolders);
    expect(restored.pathLinks).toBe(base.pathLinks);
  });

  it("drops restored links whose endpoints no longer exist", () => {
    const { change } = captureProjectChange(base, { ...base, pathLinks: [] }, null);
    const withoutP2 = { ...base, paths: [p1, p3], pathLinks: [] };
    expect(restoreProjectChange(withoutP2, change).pathLinks).toEqual([]);
  });

  it("keeps a newer link at the same endpoint instead of restoring a replaced one", () => {
    const unlinked = { ...base, pathLinks: [] };
    const { change } = captureProjectChange(base, unlinked, null);
    const appended = { id: "link-new", fromPathId: "p1", toPathId: "p3" };
    const restored = restoreProjectChange({ ...unlinked, pathLinks: [appended] }, change);
    expect(restored.pathLinks).toEqual([appended]);
  });

  it("restores a surviving path's geometry while keeping its current name and folder", () => {
    const moved = { ...p2, waypoints: [{}, {}, {}] };
    const { change } = captureProjectChange(base, { ...base, paths: [p1, moved, p3] }, null);
    const renamed = { ...moved, name: "Two renamed", folderId: "g" };
    const restored = restoreProjectChange({ ...base, paths: [p1, renamed, p3], pathFolders: [{ id: "f" }, { id: "g" }] }, change);
    expect(restored.paths[1]).toEqual({ ...p2, name: "Two renamed", folderId: "g" });
  });

  it("restores a deleted path outside a folder that no longer exists", () => {
    const { change } = captureProjectChange(base, { ...base, paths: [p1, p3], pathLinks: [] }, null);
    const restored = restoreProjectChange({ ...base, paths: [p1, p3], pathLinks: [], pathFolders: [] }, change);
    expect(restored.paths[1]).toEqual(path("p2", "Two"));
  });
});
