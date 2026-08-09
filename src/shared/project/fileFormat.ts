import type { BordeauxProject } from "../types";
import { validateProject } from "../validation";
import { normalizeProject } from "./normalize";

export const CURRENT_PROJECT_SCHEMA_VERSION = "1.0" as const;

export type ProjectSourceFormat =
  | "bordeaux-project-1.0"
  | "unversioned-project"
  | "browser-path-2.0";

export interface DecodedProjectFile {
  project: BordeauxProject;
  sourceFormat: ProjectSourceFormat;
  migrated: boolean;
}

const TRANSIENT_EDITOR_KEYS = new Set(["_selAfter", "_selT", "_selM", "_selR"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNumericRoutineReference(nodes: unknown, depth = 0): boolean {
  if (!Array.isArray(nodes)) return false;
  if (depth > 64) return false;
  return nodes.some((node) => {
    if (!isRecord(node)) return false;
    if (node.type === "path") return typeof node.ref === "number";
    if (node.type === "decision") {
      return hasNumericRoutineReference(node.then, depth + 1) || hasNumericRoutineReference(node.else, depth + 1);
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
        plannerId: "profiledSpline",
      },
      "browser-path-2.0",
      true,
    );
  }

  return validatedProject(value, "bordeaux-project-1.0", false);
}

export function decodeProjectFile(contents: string): DecodedProjectFile {
  let value: unknown;
  try {
    value = JSON.parse(contents) as unknown;
  } catch {
    throw new Error("Invalid Bordeaux project: the file is not valid JSON.");
  }
  return decodeProjectValue(value);
}

function stripEditorState(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEditorState);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TRANSIENT_EDITOR_KEYS.has(key))
      .map(([key, item]) => [key, stripEditorState(item)]),
  );
}

export function encodeProjectFile(value: unknown): { project: BordeauxProject; contents: string } {
  const clean = stripEditorState(value);
  const decoded = decodeProjectValue(clean);
  const project = { ...decoded.project, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION };
  return { project, contents: `${JSON.stringify(project, null, 2)}\n` };
}
