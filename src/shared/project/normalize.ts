import { createMarkerId, createPathId, createRoutineId, DEFAULT_LABVIEW_OPTIONS } from "./defaults";
import type { BordeauxProject, RoutineNode } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeWaypoint(raw: unknown, index: number, count: number): unknown {
  if (!isRecord(raw) || raw.stop === true || index === 0 || index === count - 1) return raw;
  const waypoint: Record<string, any> = { ...raw, linked: true, corner: false };
  if (!finite(waypoint.x) || !finite(waypoint.y) || !isRecord(waypoint.prevC) || !isRecord(waypoint.nextC)
    || !finite(waypoint.prevC.x) || !finite(waypoint.prevC.y) || !finite(waypoint.nextC.x) || !finite(waypoint.nextC.y)) return waypoint;
  const inLength = Math.hypot(waypoint.x - waypoint.prevC.x, waypoint.y - waypoint.prevC.y);
  const outLength = Math.hypot(waypoint.nextC.x - waypoint.x, waypoint.nextC.y - waypoint.y);
  const inX = inLength > 1e-6 ? (waypoint.x - waypoint.prevC.x) / inLength : 0;
  const inY = inLength > 1e-6 ? (waypoint.y - waypoint.prevC.y) / inLength : 0;
  const outX = outLength > 1e-6 ? (waypoint.nextC.x - waypoint.x) / outLength : 0;
  const outY = outLength > 1e-6 ? (waypoint.nextC.y - waypoint.y) / outLength : 0;
  let dx = inX + outX;
  let dy = inY + outY;
  let magnitude = Math.hypot(dx, dy);
  if (magnitude < 1e-6) {
    dx = outLength > 1e-6 ? outX : inX;
    dy = outLength > 1e-6 ? outY : inY;
    magnitude = Math.hypot(dx, dy);
  }
  if (magnitude < 1e-6) { dx = 1; dy = 0; magnitude = 1; }
  dx /= magnitude;
  dy /= magnitude;
  waypoint.prevC = { x: waypoint.x - dx * inLength, y: waypoint.y - dy * inLength };
  waypoint.nextC = { x: waypoint.x + dx * outLength, y: waypoint.y + dy * outLength };
  return waypoint;
}

function normalizeNodes(nodes: unknown, paths: Array<{ id: string }>): RoutineNode[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((raw) => {
    if (!raw || typeof raw !== "object") return raw as RoutineNode;
    const node = { ...raw } as Record<string, unknown>;
    if (node.type === "path") {
      if (typeof node.ref === "number") node.ref = paths[node.ref]?.id ?? "";
    } else if (node.type === "decision") {
      node.then = normalizeNodes(node.then, paths);
      node.else = normalizeNodes(node.else, paths);
    }
    return node as unknown as RoutineNode;
  });
}

export function normalizeProject(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.paths)) return value;

  const used = new Set<string>();
  const paths = source.paths.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const path = { ...(raw as Record<string, unknown>) };
    let id = typeof path.id === "string" && path.id.trim() ? path.id : createPathId();
    while (!path.id && used.has(id)) id = createPathId();
    used.add(id);
    path.id = id;
    path.labview = isRecord(path.labview)
      ? { ...DEFAULT_LABVIEW_OPTIONS, ...path.labview }
      : { ...DEFAULT_LABVIEW_OPTIONS };
    if (Array.isArray(path.waypoints)) {
      path.waypoints = path.waypoints.map((waypoint, index, waypoints) => normalizeWaypoint(waypoint, index, waypoints.length));
    }
    if (Array.isArray(path.markers)) {
      path.markers = path.markers.map((rawMarker) => {
        if (!isRecord(rawMarker)) return rawMarker;
        return {
          ...rawMarker,
          id: typeof rawMarker.id === "string" && rawMarker.id.trim() ? rawMarker.id : createMarkerId(),
        };
      });
    }
    return path;
  });

  const routineSources = Array.isArray(source.routines) && source.routines.length
    ? source.routines
    : isRecord(source.routine) ? [source.routine] : [];
  const routineIds = new Set<string>();
  const routines = routineSources.map((raw) => {
    if (!isRecord(raw)) return raw;
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : createRoutineId();
    while (routineIds.has(id)) id = createRoutineId();
    routineIds.add(id);
    return { ...raw, id, nodes: normalizeNodes(raw.nodes, paths as Array<{ id: string }>) };
  });
  const requestedRoutineId = typeof source.activeRoutineId === "string" ? source.activeRoutineId : undefined;
  const activeRoutine = routines.find((item) => isRecord(item) && item.id === requestedRoutineId) ?? routines[0];
  const activeRoutineId = isRecord(activeRoutine) && typeof activeRoutine.id === "string" ? activeRoutine.id : undefined;

  return { ...source, paths, routines, activeRoutineId, routine: activeRoutine } as unknown as BordeauxProject;
}
