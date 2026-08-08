import { createHash } from "node:crypto";
import { buildBdxExport } from "./bdx";
import { validateProjectJavaInvocations } from "../javaCommands";
import type { BordeauxProject, CommandInvocation, JavaCommandCatalog, TrajectorySample } from "../types";

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
}

export interface JavaTrajectoryPath {
  id: string;
  name: string;
  planner: string;
  totalTimeS: number;
  totalDistanceM: number;
  samples: TrajectorySample[];
  events: JavaTrajectoryEvent[];
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
  routine: ReturnType<typeof buildBdxExport>["routine"];
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

export function buildJavaTrajectory(project: BordeauxProject, catalog: JavaCommandCatalog): BuiltJavaTrajectory {
  if (!catalog.authoritative || catalog.generatedSchemaVersion !== "1.0" || !catalog.catalogId || !catalog.supportVersion || !catalog.catalogHash) {
    throw new Error("Build the annotated Java command catalog before exporting robot JSON");
  }
  const invocationIssues = validateProjectJavaInvocations(project, catalog);
  if (invocationIssues.length > 0) throw new Error(invocationIssues.map((item) => `${item.path}: ${item.message}`).join("\n"));
  const native = buildBdxExport(project);
  let sampleCount = 0;
  let eventCount = 0;
  const paths: JavaTrajectoryPath[] = native.paths.map((path) => {
    sampleCount += path.samples.length;
    const events = path.markers.flatMap((marker) => marker.invocation ? [{
      eventId: marker.id,
      name: marker.name,
      timeS: marker.timeS,
      fraction: marker.fraction,
      commandId: marker.invocation.commandId,
      arguments: marker.invocation.arguments,
      cancelOnPathEnd: marker.invocation.cancelOnPathEnd === true,
    }] : []).sort((left, right) => left.timeS - right.timeS || left.eventId.localeCompare(right.eventId));
    eventCount += events.length;
    return {
      id: path.id,
      name: path.name,
      planner: path.planner,
      totalTimeS: path.totalTimeS,
      totalDistanceM: path.totalDistanceM,
      samples: path.samples,
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
    routine: native.routine,
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
