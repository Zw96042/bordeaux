import { createHash } from "node:crypto";
import { buildBdxExport } from "./bdx";
import { DEFAULT_SAMPLES_PER_SEGMENT } from "../planners/limits";
import { validateProjectJavaInvocations } from "../javaCommands";
import { activeRoutine } from "../project/routines";
import type { BordeauxProject, CommandInvocation, FollowMode, JavaCommandCatalog, PathDoc, RoutineFallbackNode, RoutineNode, TrajectorySample } from "../types";

const MAX_SAMPLE_COUNT = 100_000;
const MAX_EVENT_COUNT = 2_000;
const MAX_PATH_COUNT = 64;
const MAX_ROUTINE_NODE_COUNT = 2_000;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;

export interface JavaTrajectoryEvent {
  eventId: string;
  name: string;
  timeS: number;
  fraction: number;
  commandId: string;
  arguments: CommandInvocation["arguments"];
  cancelOnPathEnd: boolean;
  trigger: "time" | "position";
  repeatEveryS?: number;
  endTimeS?: number;
  conditionId?: string;
}

export interface JavaTrajectoryPath {
  id: string;
  name: string;
  planner: string;
  totalTimeS: number;
  totalDistanceM: number;
  samples: TrajectorySample[];
  followSections: JavaFollowSection[];
  events: JavaTrajectoryEvent[];
}

export interface JavaFollowSection {
  segmentIndex: number;
  mode: FollowMode;
  startSample: number;
  endSample: number;
}

export interface JavaTrajectoryDocument {
  schemaVersion: "bordeaux-trajectory/1.0";
  generator: "bordeaux";
  catalog: {
    schemaVersion: "1.0" | "1.1" | "1.2" | "1.3";
    catalogId: string;
    supportVersion: string;
    catalogHash: string;
  };
  units: {
    distance: "meters";
    time: "seconds";
    angle: "radians";
    velocity: "meters_per_second";
    acceleration: "meters_per_second_squared";
  };
  field: ReturnType<typeof buildBdxExport>["field"];
  robot: ReturnType<typeof buildBdxExport>["robot"];
  routine: JavaTrajectoryRoutine | null;
  paths: JavaTrajectoryPath[];
}

interface JavaTrajectoryRoutine {
  name: string;
  nodes: RoutineNode[];
}

export interface BuiltJavaTrajectory {
  document: JavaTrajectoryDocument;
  contents: string;
  sha256: string;
  pathCount: number;
  eventCount: number;
  sampleCount: number;
}

function followSections(path: PathDoc, samples: readonly TrajectorySample[]): JavaFollowSection[] {
  const boundaries: number[] = [];
  path.waypoints.forEach((waypoint, waypointIndex) => {
    const start = waypointIndex === 0 ? 0 : boundaries[waypointIndex - 1];
    let nearest = start;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    const remainingWaypoints = path.waypoints.length - waypointIndex - 1;
    const finalSearchIndex = waypointIndex === path.waypoints.length - 1
      ? samples.length - 1
      : Math.max(start, samples.length - remainingWaypoints - 1);
    for (let index = start; index <= finalSearchIndex; index += 1) {
      const dx = samples[index].x - waypoint.x;
      const dy = samples[index].y - waypoint.y;
      const candidateDistanceSquared = dx * dx + dy * dy;
      if (candidateDistanceSquared < nearestDistanceSquared) {
        nearest = index;
        nearestDistanceSquared = candidateDistanceSquared;
      }
      // Planners preserve authored waypoint boundaries. The first matching sample is
      // the ordered arrival, including when the same coordinate is visited again.
      if (candidateDistanceSquared <= 1e-18) break;
    }
    boundaries.push(nearest);
  });
  const sections: JavaFollowSection[] = [];
  path.waypoints.slice(0, -1).forEach((waypoint, segmentIndex) => {
    const start = boundaries[segmentIndex];
    const end = boundaries[segmentIndex + 1];
    let departure = start;
    while (departure + 1 < end && Math.abs(samples[departure + 1].s - samples[start].s) < 1e-7) departure += 1;
    if (departure > start) sections.push({ segmentIndex, mode: "time", startSample: start, endSample: departure });
    sections.push({
      segmentIndex,
      mode: waypoint.segmentFollowMode ?? path.followMode ?? "time",
      startSample: departure,
      endSample: end,
    });
  });
  const arrival = boundaries.at(-1)!;
  if (arrival < samples.length - 1) sections.push({
    segmentIndex: Math.max(0, path.waypoints.length - 2),
    mode: "time",
    startSample: arrival,
    endSample: samples.length - 1,
  });
  return sections;
}

function serializedByteLengthAtMost(value: unknown, limit: number): number {
  let bytes = 0;
  const add = (count: number): boolean => {
    bytes += count;
    return bytes <= limit;
  };
  const visit = (item: unknown, arrayItem = false): boolean => {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") {
      return arrayItem ? add(4) : true;
    }
    if (item === null || typeof item === "boolean") return add(item === null ? 4 : item ? 4 : 5);
    if (typeof item === "number") return add(Buffer.byteLength(Number.isFinite(item) ? String(item) : "null", "utf8"));
    if (typeof item === "string") return add(Buffer.byteLength(JSON.stringify(item), "utf8"));
    if (typeof item === "bigint") throw new TypeError("Cannot serialize BigInt in a Java trajectory");
    if (Array.isArray(item)) {
      if (!add(1)) return false;
      for (let index = 0; index < item.length; index += 1) {
        if (index > 0 && !add(1)) return false;
        if (!visit(item[index], true)) return false;
      }
      return add(1);
    }
    if (!add(1)) return false;
    let first = true;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
      if (!first && !add(1)) return false;
      first = false;
      if (!add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1) || !visit(child)) return false;
    }
    return add(1);
  };
  visit(value);
  return bytes;
}

function assertExportSize(value: unknown): void {
  if (serializedByteLengthAtMost(value, MAX_EXPORT_BYTES) > MAX_EXPORT_BYTES) {
    throw new Error(`Java trajectory export exceeds ${MAX_EXPORT_BYTES} bytes`);
  }
}

function deployableRoutine(project: BordeauxProject, pathIds: Set<string>): JavaTrajectoryRoutine | null {
  const routine = activeRoutine(project);
  if (!routine) return null;
  function nodes(source: RoutineFallbackNode[]): RoutineFallbackNode[];
  function nodes(source: RoutineNode[]): RoutineNode[];
  function nodes(source: RoutineNode[]): RoutineNode[] {
    return source.map((node) => {
      if (node.type === "path") {
        if (!pathIds.has(node.ref)) throw new Error(`Routine path ${node.ref} is not Java-exportable`);
        return { id: node.id, type: "path", ref: node.ref };
      }
      if (node.type === "decision") {
        if (!/^[A-Za-z0-9_.:#()$,-]{1,256}$/.test(node.cond)) throw new Error(`Routine decision ${node.id} needs a stable condition ID`);
        return { id: node.id, type: "decision", cond: node.cond, thenLabel: node.thenLabel, elseLabel: node.elseLabel, then: nodes(node.then), else: nodes(node.else) };
      }
      if (node.type === "builtin") {
        if (node.builtinId !== "bordeaux.wait" || !Number.isFinite(node.arguments.durationS) || node.arguments.durationS < 0.02 || node.arguments.durationS > 15
          || Object.keys(node.arguments).length !== 1) {
          throw new Error(`Routine built-in ${node.id} is invalid for Java export`);
        }
        return { id: node.id, type: "builtin", builtinId: "bordeaux.wait", arguments: { durationS: node.arguments.durationS } };
      }
      if (node.type === "generatedTrajectory") {
        return {
          id: node.id,
          type: "generatedTrajectory",
          generatorId: node.generatorId,
          arguments: node.arguments,
          fallback: node.fallback.type === "safeStop"
            ? { type: "safeStop" }
            : { type: "branch", nodes: nodes(node.fallback.nodes) },
        };
      }
      if (node.cat !== "command" || !node.invocation) {
        throw new Error(`Routine function ${node.id} is simulation-only; use a bound Command step for Java export`);
      }
      return { id: node.id, type: "function", cat: "command", title: node.title, invocation: node.invocation };
    });
  }
  return { name: routine.name, nodes: nodes(routine.nodes) };
}

function assertRoutineNodeCount(routine: JavaTrajectoryRoutine | null): void {
  if (!routine) return;
  let count = 0;
  const pending = [...routine.nodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    count += 1;
    if (count > MAX_ROUTINE_NODE_COUNT) {
      throw new Error(`Java trajectory export exceeds ${MAX_ROUTINE_NODE_COUNT} routine nodes`);
    }
    if (node.type === "decision") pending.push(...node.then, ...node.else);
    if (node.type === "generatedTrajectory" && node.fallback.type === "branch") pending.push(...node.fallback.nodes);
  }
}

function projectForStaticPlanning(project: BordeauxProject): BordeauxProject {
  const staticNodes = (nodes: RoutineNode[]): RoutineNode[] => nodes.flatMap((node) => {
    if (node.type === "generatedTrajectory") return node.fallback.type === "branch" ? staticNodes(node.fallback.nodes) : [];
    if (node.type === "decision") return [{ ...node, then: staticNodes(node.then), else: staticNodes(node.else) }];
    return [node];
  });
  return { ...project, routines: project.routines.map((routine) => ({ ...routine, nodes: staticNodes(routine.nodes) })) };
}

export function buildJavaTrajectory(project: BordeauxProject, catalog: JavaCommandCatalog): BuiltJavaTrajectory {
  if (!catalog.authoritative || (catalog.generatedSchemaVersion !== "1.0" && catalog.generatedSchemaVersion !== "1.1" && catalog.generatedSchemaVersion !== "1.2" && catalog.generatedSchemaVersion !== "1.3") || !catalog.catalogId || !catalog.supportVersion || !catalog.catalogHash) {
    throw new Error("Build the annotated Java command catalog before exporting robot JSON");
  }
  const invocationIssues = validateProjectJavaInvocations(project, catalog);
  if (invocationIssues.length > 0) throw new Error(invocationIssues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const sourcePaths = project.paths.filter((path) => path.exportable !== false);
  if (sourcePaths.length > MAX_PATH_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_PATH_COUNT} paths`);
  let baseSampleCount = 0;
  for (const path of sourcePaths) {
    baseSampleCount += Math.max(0, path.waypoints.length - 1) * DEFAULT_SAMPLES_PER_SEGMENT + 1;
    if (baseSampleCount > MAX_SAMPLE_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_SAMPLE_COUNT} samples`);
  }
  let eventCount = 0;
  for (const path of sourcePaths) {
    eventCount += path.markers.reduce((count, marker) => count + (marker.invocation ? 1 : 0), 0);
    if (eventCount > MAX_EVENT_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_EVENT_COUNT} events`);
  }
  const routine = deployableRoutine(project, new Set(sourcePaths.map((path) => path.id)));
  if (routine && routine.nodes.some(function containsBuiltIn(node): boolean {
    return node.type === "builtin" || (node.type === "decision" && [...node.then, ...node.else].some(containsBuiltIn));
  }) && catalog.generatedSchemaVersion !== "1.2" && catalog.generatedSchemaVersion !== "1.3") {
    throw new Error("Routine built-ins require generated catalog schema 1.2 or newer before export");
  }
  assertRoutineNodeCount(routine);
  assertExportSize({
    catalog: {
      schemaVersion: catalog.generatedSchemaVersion,
      catalogId: catalog.catalogId,
      supportVersion: catalog.supportVersion,
      catalogHash: catalog.catalogHash,
    },
    robot: project.robot,
    routine,
    paths: sourcePaths.map((path) => ({
      id: path.id,
      name: path.name,
      events: path.markers.flatMap((marker) => marker.invocation ? [{
        eventId: marker.id,
        name: marker.name,
        invocation: marker.invocation,
        schedule: marker.schedule,
      }] : []),
    })),
  });

  // Static planning has no geometry for runtime-dynamic nodes. Their separately
  // validated fallback is sufficient for the generic project validator here;
  // the exported routine below retains the generated node itself.
  const native = buildBdxExport(projectForStaticPlanning(project));
  let sampleCount = 0;
  const paths: JavaTrajectoryPath[] = [];
  native.paths.forEach((path, pathIndex) => {
    sampleCount += path.samples.length;
    if (sampleCount > MAX_SAMPLE_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_SAMPLE_COUNT} samples`);
    const sourceMarkers = new Map(sourcePaths[pathIndex].markers.map((marker) => [marker.id, marker]));
    const events = path.markers.flatMap((marker) => {
      if (!marker.invocation) return [];
      const source = sourceMarkers.get(marker.id);
      if (source?.schedule?.endTimeS !== undefined && source.schedule.endTimeS < marker.timeS) {
        throw new Error(`Event ${marker.name} ends before it starts`);
      }
      return [{
        eventId: marker.id,
        name: marker.name,
        timeS: marker.timeS,
        fraction: marker.fraction,
        commandId: marker.invocation.commandId,
        arguments: marker.invocation.arguments,
        cancelOnPathEnd: marker.invocation.cancelOnPathEnd === true,
        trigger: source?.schedule?.trigger ?? "time",
        ...(source?.schedule?.repeatEveryS === undefined ? {} : { repeatEveryS: source.schedule.repeatEveryS }),
        ...(source?.schedule?.endTimeS === undefined ? {} : { endTimeS: source.schedule.endTimeS }),
        ...(source?.schedule?.conditionId ? { conditionId: source.schedule.conditionId } : {}),
      }];
    }).sort((left, right) => left.timeS - right.timeS || left.eventId.localeCompare(right.eventId));
    paths.push({
      id: path.id,
      name: path.name,
      planner: path.planner,
      totalTimeS: path.totalTimeS,
      totalDistanceM: path.totalDistanceM,
      samples: path.samples,
      followSections: followSections(sourcePaths[pathIndex], path.samples),
      events,
    });
  });
  const document: JavaTrajectoryDocument = {
    schemaVersion: "bordeaux-trajectory/1.0",
    generator: "bordeaux",
    catalog: {
      schemaVersion: catalog.generatedSchemaVersion,
      catalogId: catalog.catalogId,
      supportVersion: catalog.supportVersion,
      catalogHash: catalog.catalogHash,
    },
    field: native.field,
    units: native.units,
    robot: native.robot,
    routine,
    paths,
  };
  assertExportSize(document);
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_EXPORT_BYTES) throw new Error(`Java trajectory export exceeds ${MAX_EXPORT_BYTES} bytes`);
  return {
    document,
    contents,
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    pathCount: paths.length,
    eventCount,
    sampleCount,
  };
}

export function javaTrajectoryFileName(projectName: string): string {
  const base = projectName.normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return `${base || "autonomous"}.bordeaux.json`;
}
