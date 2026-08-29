import type { ControlPoint, PathDoc, Waypoint } from "../../shared/types";
import { clone } from "../../shared/project/defaults";
import { PathEdit } from "../assets/path-edit";
import { PathBrush } from "./pathBrush";

export interface BrushStroke {
  kind: "push" | "smooth" | "twirl";
  center: ControlPoint;
  previous?: ControlPoint;
  origin?: ControlPoint;
  radius: number;
  strength: number;
}
export interface EditorSelection {
  kind: "wp" | "seg" | "rt" | "em" | "cr" | null;
  idx: number;
}

// Brush drags stay in one draft and produce one undo entry. A stroke that never
// reaches the path remains a true no-op.
export function applyBrushDraft(editStore: ReturnType<typeof PathEdit.create<PathDoc>>, source: PathDoc, stroke: BrushStroke) {
  const active = editStore.getSnapshot();
  const candidate = clone(active || source);
  const beforeWaypoints = candidate.waypoints.slice();
  const result = PathBrush.apply(candidate, stroke);
  if (result.changed) {
    if (!active) editStore.begin(result.path);
    editStore.update(result.path);
  }
  return { path: candidate, changed: result.changed, added: result.added, removed: result.removed, beforeWaypoints };
}

export function remapBrushSelection(selection: EditorSelection, beforeWaypoints: Waypoint[], afterWaypoints: Waypoint[]): EditorSelection {
  if (!selection || (selection.kind !== 'wp' && selection.kind !== 'seg')) return selection;
  if (selection.kind === 'wp') {
    const moved = afterWaypoints.indexOf(beforeWaypoints[selection.idx]);
    return moved >= 0 ? { kind: 'wp', idx: moved } : { kind: null, idx: -1 };
  }
  const start = afterWaypoints.indexOf(beforeWaypoints[selection.idx]);
  const end = afterWaypoints.indexOf(beforeWaypoints[selection.idx + 1]);
  if (start >= 0 && start < afterWaypoints.length - 1) return { kind: 'seg', idx: start };
  if (end > 0) return { kind: 'seg', idx: end - 1 };
  return { kind: null, idx: -1 };
}

export function syncBrushSelection(selectionRef: { current: EditorSelection }, beforeWaypoints: Waypoint[], afterWaypoints: Waypoint[], onSelect: (kind: EditorSelection["kind"], index: number) => void) {
  const current = selectionRef.current;
  const next = remapBrushSelection(current, beforeWaypoints, afterWaypoints);
  if (next && (next.kind !== current.kind || next.idx !== current.idx)) {
    selectionRef.current = next;
    onSelect(next.kind, next.idx);
  }
}

