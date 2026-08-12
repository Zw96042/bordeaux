import { AUTO } from "../lib/routineModel";
import { PathPreview } from "./path-preview";

function referencedPaths(routine, paths, outcomes) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const referenced = [];
  const seen = new Set();
  const collect = (nodes) => (nodes || []).forEach((node) => {
    if (node.type === 'decision') {
      collect((outcomes?.[node.id] || 'then') === 'else' ? node.else : node.then);
      return;
    }
    // Generated previews remain embedded on their routine node. Mixing them into
    // this authored-path lookup lets a preview with the same ID shadow the path.
    const path = node.type === 'path' ? byId.get(node.ref) : null;
    if (path && !seen.has(path)) { seen.add(path); referenced.push(path); }
  });
  collect(routine?.nodes);
  return referenced;
}

function directRoutineWork(routine, paths, perSegment = 56) {
  const byId = new Map((paths || []).map((path) => [path.id, path]));
  const unique = new Set();
  // Routine assembly and lookup still cost work even when every node reuses one path.
  // Weight each node conservatively so direct fallback stays comfortably below a frame.
  let total = byId.size;
  AUTO.walk(routine?.nodes || [], (node) => {
    total += 16;
    const path = node.type === 'path'
      ? byId.get(node.ref)
      : node.type === 'function' && node.cat === 'generate' ? node.preview : null;
    if (!path || unique.has(path)) return;
    unique.add(path);
    total += PathPreview.directPreviewWork(path, perSegment);
  });
  return total;
}

export const RoutinePreview = Object.freeze({ directRoutineWork, referencedPaths });
