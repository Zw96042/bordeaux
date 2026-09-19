import { describe, expect, it } from "vitest";
import { replaceEditedPath } from "../src/renderer/app/App";
import { PathLinks } from "../src/renderer/lib/pathLinks";
import {
  PROJECT_SCOPE, applyProjectEntry, captureProjectChange, createUndoHistory, deleteFolder, linkedPathIds, pathScope,
  undoScopes, withLibraryFields,
} from "../src/renderer/lib/undoHistory";

const point = (x, y = 0, extra = {}) => ({ x, y, ...extra });
const path = (id, waypoints, extra = {}) => ({ id, name: id.toUpperCase(), waypoints, markers: [], ...extra });
const project = (paths, extra = {}) => ({ name: "Fixture", paths, pathLinks: [], pathFolders: [], robot: { planning: { maxVel: 3 } }, ...extra });
const find = (value, id) => value.paths.find((item) => item.id === id);

/**
 * Records and applies entries the way App does: path edits snapshot the whole
 * path and re-sync linked positions; project, shared-position, and folder
 * entries go through the shared helpers.
 */
function editor(initial) {
  const history = createUndoHistory();
  let current = initial;
  const apply = (entry) => {
    if (entry.kind === "path") {
      const saved = find(current, entry.path.id);
      if (!saved) return null;
      current = replaceEditedPath(current, withLibraryFields(entry.path, saved));
      return { ...entry, path: saved };
    }
    const applied = applyProjectEntry(current, entry, null);
    if (!applied) return null;
    current = applied.project;
    return applied.inverse;
  };
  const scopes = (pathId) => undoScopes("plan", pathId);
  return {
    get project() { return current; },
    edit(id, update) {
      const saved = find(current, id);
      history.record({ scope: pathScope(id), kind: "path", touches: linkedPathIds(current, id).map(pathScope), path: saved });
      current = replaceEditedPath(current, update(structuredClone(saved)));
    },
    change(next, scope = PROJECT_SCOPE) {
      history.record({ scope, kind: scope === PROJECT_SCOPE ? "project" : "waypoints", ...captureProjectChange(current, next, null) });
      current = next;
    },
    removeFolder(id) {
      const deleted = deleteFolder(current, id);
      history.record({ scope: PROJECT_SCOPE, touches: [], kind: "folder", restore: deleted.change });
      current = deleted.project;
    },
    /** Library names, moves, and new folders are not journaled. */
    library(update) { current = update(current); },
    canUndo: (pathId) => history.canUndo(scopes(pathId)),
    undo: (pathId) => history.undo(scopes(pathId), apply),
    redo: (pathId) => history.redo(scopes(pathId), apply),
  };
}

/** Saving and reopening normalizes links; a consistent project comes back unchanged. */
const reload = (value) => PathLinks.reconcile(JSON.parse(JSON.stringify(value)));
const moveEnd = (x) => (draft) => { draft.waypoints[draft.waypoints.length - 1] = point(x, 0, { positionLink: draft.waypoints.at(-1).positionLink }); return draft; };
const moveStart = (x) => (draft) => { draft.waypoints[0] = point(x, 0, { positionLink: draft.waypoints[0].positionLink }); return draft; };

describe("linked restoration across newer neighbor edits", () => {
  const shared = () => project([
    path("a", [point(0), point(1, 0, { positionLink: "g" })]),
    path("b", [point(1, 0, { positionLink: "g" }), point(2)]),
    path("c", [point(5, 5), point(6, 5)]),
  ]);

  it("blocks undoing a shared-position deletion past a newer edit to the former neighbor", () => {
    const session = editor(shared());
    const before = session.project;
    session.change({ ...before, paths: before.paths.filter((item) => item.id !== "b") });
    session.edit("a", moveEnd(5));
    expect(find(session.project, "a").waypoints[1].x).toBe(5);

    expect(session.canUndo("c")).toBe(false);
    expect(session.undo("c")).toBe(false);
    expect(find(session.project, "b")).toBeUndefined();

    // Undo the neighbor's newer edit on its own path first; then the deletion applies consistently.
    expect(session.undo("a")).toBe(true);
    expect(session.canUndo("c")).toBe(true);
    expect(session.undo("c")).toBe(true);
    expect(session.project.paths.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(find(session.project, "a").waypoints[1].x).toBe(1);
    expect(find(session.project, "b").waypoints[0].x).toBe(1);
    expect(reload(session.project)).toEqual(session.project);

    // Redo replays both in order, and the result reloads unchanged.
    expect(session.redo("c")).toBe(true);
    expect(find(session.project, "b")).toBeUndefined();
    expect(session.redo("a")).toBe(true);
    expect(find(session.project, "a").waypoints[1].x).toBe(5);
    expect(reload(session.project)).toEqual(session.project);
  });

  it("blocks undoing an endpoint-link deletion past a newer edit to the former neighbor", () => {
    const linked = project([path("a", [point(0), point(1)]), path("b", [point(1), point(2)]), path("c", [point(5, 5), point(6, 5)])],
      { pathLinks: [{ id: "ab", fromPathId: "a", toPathId: "b" }] });
    const session = editor(linked);
    session.change({ ...linked, paths: linked.paths.filter((item) => item.id !== "b"), pathLinks: [] });
    session.edit("a", moveEnd(4));
    expect(session.canUndo("c")).toBe(false);
    session.undo("a");
    expect(session.undo("c")).toBe(true);
    expect(session.project.pathLinks).toEqual(linked.pathLinks);
    expect(find(session.project, "b").waypoints[0].x).toBe(find(session.project, "a").waypoints[1].x);
    expect(reload(session.project)).toEqual(session.project);
  });

  it("blocks undoing an endpoint unlink past a newer edit to the unlinked path", () => {
    const linked = project([path("a", [point(0), point(1)]), path("b", [point(1), point(2)]), path("c", [point(5, 5), point(6, 5)])],
      { pathLinks: [{ id: "ab", fromPathId: "a", toPathId: "b" }] });
    const session = editor(linked);
    // The unlink changes only pathLinks, from A's shared-position inspector.
    const unlinked = PathLinks.unlinkPosition(linked, "a", 1);
    expect(unlinked.paths).toEqual(linked.paths);
    session.change(unlinked, pathScope("a"));
    session.edit("b", moveStart(3));

    expect(session.canUndo("a")).toBe(false);
    expect(session.undo("a")).toBe(false);
    expect(session.project.pathLinks).toEqual([]);

    // Switch to the dependent path, undo its newer edit, then undo the unlink from A.
    expect(session.undo("b")).toBe(true);
    expect(session.undo("a")).toBe(true);
    expect(session.project.pathLinks).toEqual(linked.pathLinks);
    expect(find(session.project, "b").waypoints[0].x).toBe(1);
    expect(reload(session.project)).toEqual(session.project);
    expect(session.redo("a")).toBe(true);
    expect(session.project.pathLinks).toEqual([]);
    expect(session.redo("b")).toBe(true);
    expect(find(session.project, "b").waypoints[0].x).toBe(3);
    expect(reload(session.project)).toEqual(session.project);
  });

  it("blocks undoing a shared-position unlink past a newer edit to a former group member", () => {
    const session = editor(shared());
    session.change(PathLinks.unlinkPosition(session.project, "a", 1), pathScope("a"));
    session.edit("b", moveStart(3));
    expect(session.canUndo("a")).toBe(false);
    session.undo("b");
    expect(session.undo("a")).toBe(true);
    expect(find(session.project, "a").waypoints[1]).toEqual(point(1, 0, { positionLink: "g" }));
    expect(reload(session.project)).toEqual(session.project);
  });

  it("still undoes a deletion past newer edits to unrelated paths", () => {
    const session = editor(shared());
    session.change({ ...session.project, paths: session.project.paths.filter((item) => item.id !== "b") });
    session.edit("c", moveEnd(7));
    expect(session.undo("a")).toBe(true);
    expect(find(session.project, "b").waypoints[0].x).toBe(1);
    expect(find(session.project, "c").waypoints[1].x).toBe(7);
  });

  it("restores a deleted path without overriding a link that replaced its own", () => {
    const linked = project([path("a", [point(0), point(1)]), path("b", [point(1), point(2)])], { pathLinks: [{ id: "ab", fromPathId: "a", toPathId: "b" }] });
    const session = editor(linked);
    session.change({ ...linked, paths: [linked.paths[0]], pathLinks: [] });
    // Appending from A is not journaled; it links A to a new path.
    session.library((value) => ({ ...value, paths: [...value.paths, path("n", [point(1), point(3)])], pathLinks: [{ id: "an", fromPathId: "a", toPathId: "n" }] }));
    expect(session.undo("a")).toBe(true);
    expect(session.project.paths.map((item) => item.id)).toEqual(["a", "b", "n"]);
    expect(session.project.pathLinks).toEqual([{ id: "an", fromPathId: "a", toPathId: "n" }]);
    expect(reload(session.project)).toEqual(session.project);
  });
});

describe("folder deletion history", () => {
  const library = () => project([
    path("a", [point(0), point(1)], { folderId: "f" }),
    path("b", [point(2), point(3)]),
    path("c", [point(4), point(5)], { folderId: "f" }),
  ], { pathFolders: [{ id: "e", name: "Early" }, { id: "f", name: "Center" }] });
  const references = (value) => value.paths.filter((item) => item.folderId).every((item) => value.pathFolders.some((folder) => folder.id === item.folderId));

  it("restores the folder without removing newer folders or moves", () => {
    const session = editor(library());
    session.removeFolder("f");
    expect(session.project.paths.map((item) => item.folderId)).toEqual([undefined, undefined, undefined]);
    session.library((value) => ({ ...value,
      pathFolders: [...value.pathFolders.map((folder) => folder.id === "e" ? { ...folder, name: "Early renamed" } : folder), { id: "g", name: "Later" }],
      paths: value.paths.map((item) => item.id === "b" ? { ...item, folderId: "g" } : item.id === "c" ? { ...item, folderId: "g", name: "C renamed" } : item) }));

    expect(session.undo("b")).toBe(true);
    expect(session.project.pathFolders).toEqual([{ id: "e", name: "Early renamed" }, { id: "f", name: "Center" }, { id: "g", name: "Later" }]);
    // A rejoins; B and C keep their newer folder and name.
    expect(session.project.paths.map((item) => [item.id, item.name, item.folderId])).toEqual([["a", "A", "f"], ["b", "B", "g"], ["c", "C renamed", "g"]]);
    expect(session.project.paths.map((item) => item.waypoints)).toEqual(library().paths.map((item) => item.waypoints));
    expect(references(session.project)).toBe(true);
    expect(reload(session.project)).toEqual(session.project);

    expect(session.redo("b")).toBe(true);
    expect(session.project.pathFolders.map((folder) => folder.id)).toEqual(["e", "g"]);
    expect(session.project.paths.map((item) => item.folderId)).toEqual([undefined, "g", "g"]);
    expect(references(session.project)).toBe(true);
    expect(session.undo("b")).toBe(true);
    expect(session.project.paths.map((item) => item.folderId)).toEqual(["f", "g", "g"]);
    expect(references(reload(session.project))).toBe(true);
  });

  it("restores a renamed folder's current name when redone and undone again", () => {
    const session = editor(library());
    session.removeFolder("f");
    session.undo("a");
    session.library((value) => ({ ...value, pathFolders: value.pathFolders.map((folder) => folder.id === "f" ? { ...folder, name: "Center renamed" } : folder) }));
    session.redo("a");
    session.undo("a");
    expect(session.project.pathFolders).toEqual([{ id: "e", name: "Early" }, { id: "f", name: "Center renamed" }]);
  });

  it("keeps folder memberships resolvable when a path deleted from the folder is restored later", () => {
    const session = editor(library());
    session.change({ ...session.project, paths: session.project.paths.filter((item) => item.id !== "c") });
    session.removeFolder("f");
    // Project entries undo newest first: the folder, then the path back into it.
    session.undo("a"); session.undo("a");
    expect(session.project.paths.map((item) => [item.id, item.folderId])).toEqual([["a", "f"], ["b", undefined], ["c", "f"]]);
    expect(references(session.project)).toBe(true);
  });
});
