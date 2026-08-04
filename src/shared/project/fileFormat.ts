import type { BordeauxProject } from "../types";
import { validateProject } from "../validation";
import { normalizeProject } from "./normalize";

export const CURRENT_PROJECT_SCHEMA_VERSION = "1.0" as const;

export type ProjectSourceFormat =
  | "bordeaux-project-1.0"
  | "unversioned-project"
  | "browser-path-2.0"
  | "labview-bdx-4.4";

export interface DecodedProjectFile {
  project: BordeauxProject;
  sourceFormat: ProjectSourceFormat;
  migrated: boolean;
}

const TRANSIENT_EDITOR_KEYS = new Set(["_selAfter", "_selT", "_selM", "_selR"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNumericRoutineReference(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => {
    if (!isRecord(node)) return false;
    if (node.type === "path") return typeof node.ref === "number";
    if (node.type === "decision") {
      return hasNumericRoutineReference(node.then) || hasNumericRoutineReference(node.else);
    }
    return false;
  });
}

function needsV1Migration(value: Record<string, unknown>): boolean {
  const hasMissingPathId = Array.isArray(value.paths) && value.paths.some((path) =>
    isRecord(path) && (typeof path.id !== "string" || !path.id.trim()),
  );
  const routine = isRecord(value.routine) ? value.routine : undefined;
  return hasMissingPathId || hasNumericRoutineReference(routine?.nodes);
}

function validatedProject(value: unknown, sourceFormat: ProjectSourceFormat, migrated: boolean): DecodedProjectFile {
  const project = normalizeProject(value);
  const validation = validateProject(project);
  if (!validation.ok) {
    const message = validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
    throw new Error(`Invalid Bordeaux project:\n${message}`);
  }
  return { project: project as BordeauxProject, sourceFormat, migrated };
}

export function decodeProjectValue(value: unknown): DecodedProjectFile {
  if (!isRecord(value)) return validatedProject(value, "bordeaux-project-1.0", false);

  if (value.schemaVersion !== undefined) {
    if (value.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Bordeaux project schema version ${JSON.stringify(value.schemaVersion)}. ` +
        `This version of Bordeaux supports ${CURRENT_PROJECT_SCHEMA_VERSION}.`,
      );
    }
    return validatedProject(value, "bordeaux-project-1.0", needsV1Migration(value));
  }

  if (Array.isArray(value.paths)) {
    return validatedProject(
      { ...value, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
      "unversioned-project",
      true,
    );
  }

  if (Array.isArray(value.waypoints) && value.version !== undefined) {
    if (value.version !== "2.0") {
      throw new Error(
        `Unsupported Bordeaux path version ${JSON.stringify(value.version)}. This version of Bordeaux supports browser path 2.0.`,
      );
    }
    const { version: _version, robot, ...path } = value;
    const name = typeof value.name === "string" && value.name.trim() ? value.name : "Imported Path";
    return validatedProject(
      {
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        name,
        robot,
        paths: [path],
        routine: { name: "Autonomous Routine", nodes: [] },
