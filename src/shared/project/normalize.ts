import { alignedWaypointHandles } from "./waypointHandles";
import { createMarkerId, createPathId, createPathLinkId, createRoutineId } from "./ids";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeWaypoint(raw: unknown, index: number, count: number): unknown {
  if (!isRecord(raw)) return raw;
  const waypoint = { ...raw };
  delete waypoint.headingTransition;
  if (raw.stop === true || index === 0 || index === count - 1) return waypoint;
  waypoint.linked = true;
  waypoint.corner = false;
  if (!finite(waypoint.x) || !finite(waypoint.y) || !isRecord(waypoint.prevC) || !isRecord(waypoint.nextC)
    || !finite(waypoint.prevC.x) || !finite(waypoint.prevC.y) || !finite(waypoint.nextC.x) || !finite(waypoint.nextC.y)) return waypoint;
  Object.assign(waypoint, alignedWaypointHandles({
    x: waypoint.x, y: waypoint.y,
    prevC: { x: waypoint.prevC.x, y: waypoint.prevC.y },
    nextC: { x: waypoint.nextC.x, y: waypoint.nextC.y },
  }, true));
  return waypoint;
}

function normalizeNodes(nodes: unknown, paths: readonly unknown[], depth = 0): unknown {
  if (!Array.isArray(nodes)) return nodes;
  if (depth > 64) return nodes;
  return nodes.map((raw) => {
    if (!isRecord(raw)) return raw;
    const node: Record<string, unknown> = { ...raw };
    if (node.type === "path") {
      if (typeof node.ref === "number") {
        const path = paths[node.ref];
        node.ref = isRecord(path) ? path.id ?? "" : "";
      }
    } else if (node.type === "decision") {
      node.then = normalizeNodes(node.then, paths, depth + 1);
      node.else = normalizeNodes(node.else, paths, depth + 1);
    }
    return node;
  });
}

export function normalizeProject(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const source = value;
  if (!Array.isArray(source.paths)) return value;

  const used = new Set<string>();
  const paths = source.paths.map((raw) => {
    if (!isRecord(raw)) return raw;
    const path = { ...raw };
    let id = typeof path.id === "string" && path.id.trim() ? path.id : createPathId();
    while (!path.id && used.has(id)) id = createPathId();
    used.add(id);
    path.id = id;
    delete path.labview;
    if (isRecord(path.constraints) && path.constraints.maxAngDecel === 0) {
      path.constraints = { ...path.constraints, maxAngDecel: path.constraints.maxAngAccel };
    }
    if (Array.isArray(path.waypoints)) {
      path.waypoints = path.waypoints.map((waypoint, index, waypoints) => normalizeWaypoint(waypoint, index, waypoints.length));
    }
    if (Array.isArray(path.ranges)) {
      path.ranges = path.ranges.map((rawRange) => {
        if (!isRecord(rawRange)) return rawRange;
        const range = { ...rawRange };
        delete range.rotationPriority;
        return range;
      });
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
    : isRecord(source.routine) ? [source.routine] : [{ name: "Autonomous Routine", nodes: [] }];
  const routineIds = new Set<string>();
  const routines = routineSources.map((raw) => {
    if (!isRecord(raw)) return raw;
    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id : createRoutineId();
    while (routineIds.has(id)) id = createRoutineId();
    routineIds.add(id);
    return { ...raw, id, nodes: normalizeNodes(raw.nodes, paths) };
  });
  const requestedRoutineId = typeof source.activeRoutineId === "string" ? source.activeRoutineId : undefined;
  const activeRoutine = routines.find((item) => isRecord(item) && item.id === requestedRoutineId) ?? routines[0];
  const activeRoutineId = isRecord(activeRoutine) && typeof activeRoutine.id === "string" ? activeRoutine.id : undefined;

  const pathLinks = Array.isArray(source.pathLinks) ? source.pathLinks.map((raw) => {
    if (!isRecord(raw)) return raw;
    return { ...raw, id: typeof raw.id === "string" && raw.id.trim() ? raw.id : createPathLinkId() };
  }) : [];

  const plannerId = source.plannerId === "optimizedTrajectory" ? "optimizedTrajectory" : "profiledSpline";
  const canonicalSource = { ...source };
  delete canonicalSource.routine;
  return { ...canonicalSource, paths, pathLinks, routines, activeRoutineId, plannerId };
}
