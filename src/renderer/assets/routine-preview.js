import { AUTO } from "../lib/routineModel";
import { PathPreview } from "./path-preview";

function directRoutineWork(routine, paths, perSegment = 56) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const unique = new Set();
  let total = 0;
  AUTO.walk(routine?.nodes || [], (node) => {
    const path = node.type === 'path'
      ? byId.get(node.ref)
      : node.type === 'function' && node.cat === 'generate' ? node.preview : null;
    if (!path || unique.has(path)) return;
    unique.add(path);
    total += PathPreview.directPreviewWork(path, perSegment);
  });
  return total;
}

export const RoutinePreview = Object.freeze({ directRoutineWork });
