import { createHash } from "node:crypto";
import { buildBdxExport } from "./bdx";
import { validateProjectJavaInvocations } from "../javaCommands";
import type { AutonomousRoutine, BordeauxProject, CommandInvocation, FollowMode, JavaCommandCatalog, PathDoc, RoutineNode, TrajectorySample } from "../types";

const MAX_SAMPLE_COUNT = 1_000_000;
const MAX_EVENT_COUNT = 10_000;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;

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
    schemaVersion: "1.0";
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
  robot: ReturnType<typeof buildBdxExport>["robot"];
  routine: AutonomousRoutine | null;
  paths: JavaTrajectoryPath[];
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
    for (let index = start; index < samples.length; index += 1) {
      if (Math.hypot(samples[index].x - waypoint.x, samples[index].y - waypoint.y)
        < Math.hypot(samples[nearest].x - waypoint.x, samples[nearest].y - waypoint.y)) nearest = index;
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

function deployableRoutine(project: BordeauxProject, pathIds: Set<string>): AutonomousRoutine | null {
  if (!project.routine) return null;
  const nodes = (source: RoutineNode[]): RoutineNode[] => source.map((node) => {
    if (node.type === "path") {
      if (!pathIds.has(node.ref)) throw new Error(`Routine path ${node.ref} is not Java-exportable`);
      return { id: node.id, type: "path", ref: node.ref };
    }
    if (node.type === "decision") {
      if (!/^[A-Za-z0-9_.:#()$,-]{1,256}$/.test(node.cond)) throw new Error(`Routine decision ${node.id} needs a stable condition ID`);
      return { id: node.id, type: "decision", cond: node.cond, thenLabel: node.thenLabel, elseLabel: node.elseLabel, then: nodes(node.then), else: nodes(node.else) };
    }
    if (node.cat !== "command" || !node.invocation) {
      throw new Error(`Routine function ${node.id} is simulation-only; use a bound Command step for Java export`);
    }
    return { id: node.id, type: "function", cat: "command", title: node.title, invocation: node.invocation };
  });
  return { name: project.routine.name, nodes: nodes(project.routine.nodes) };
}

export function buildJavaTrajectory(project: BordeauxProject, catalog: JavaCommandCatalog): BuiltJavaTrajectory {
  if (!catalog.authoritative || catalog.generatedSchemaVersion !== "1.0" || !catalog.catalogId || !catalog.supportVersion || !catalog.catalogHash) {
    throw new Error("Build the annotated Java command catalog before exporting robot JSON");
  }
  const invocationIssues = validateProjectJavaInvocations(project, catalog);
  if (invocationIssues.length > 0) throw new Error(invocationIssues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const native = buildBdxExport(project);
  let sampleCount = 0;
  let eventCount = 0;
  const sourcePaths = project.paths.filter((path) => path.exportable !== false);
  const paths: JavaTrajectoryPath[] = native.paths.map((path, pathIndex) => {
    sampleCount += path.samples.length;
    const events = path.markers.flatMap((marker) => {
      if (!marker.invocation) return [];
      const source = sourcePaths[pathIndex].markers.find((candidate) => candidate.id === marker.id);
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
    eventCount += events.length;
    return {
      id: path.id,
      name: path.name,
      planner: path.planner,
      totalTimeS: path.totalTimeS,
      totalDistanceM: path.totalDistanceM,
      samples: path.samples,
      followSections: followSections(sourcePaths[pathIndex], path.samples),
      events,
    };
  });
  if (sampleCount > MAX_SAMPLE_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_SAMPLE_COUNT} samples`);
  if (eventCount > MAX_EVENT_COUNT) throw new Error(`Java trajectory export exceeds ${MAX_EVENT_COUNT} events`);
  const document: JavaTrajectoryDocument = {
    schemaVersion: "bordeaux-trajectory/1.0",
    generator: "bordeaux",
    catalog: {
      schemaVersion: "1.0",
      catalogId: catalog.catalogId,
      supportVersion: catalog.supportVersion,
      catalogHash: catalog.catalogHash,
    },
    units: native.units,
    robot: native.robot,
    routine: deployableRoutine(project, new Set(paths.map((path) => path.id))),
    paths,
  };
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
