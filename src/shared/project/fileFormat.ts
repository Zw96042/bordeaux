import type { BordeauxProject } from "../types";
import { validateProject } from "../validation";
import { normalizeProject } from "./normalize";

const CURRENT_PROJECT_SCHEMA_VERSION = "1.0" as const;

export interface DecodedProjectFile {
  project: BordeauxProject;
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
  const routines = Array.isArray(value.routines) ? value.routines : [];
  const routineIds = new Set(routines.flatMap((routine) =>
    isRecord(routine) && typeof routine.id === "string" && routine.id.trim() ? [routine.id] : [],
  ));
  const hasInvalidRoutineState = routines.length === 0
    || routines.some((routine) => !isRecord(routine) || typeof routine.id !== "string" || !routine.id.trim())
    || typeof value.activeRoutineId !== "string"
    || !routineIds.has(value.activeRoutineId);
  const hasNumericReference = routines.some((routine) => isRecord(routine) && hasNumericRoutineReference(routine.nodes))
    || (isRecord(value.routine) && hasNumericRoutineReference(value.routine.nodes));
  const hasInvalidPlanner = value.plannerId !== "profiledSpline" && value.plannerId !== "optimizedTrajectory";
  const hasLegacyAngularDeceleration = Array.isArray(value.paths) && value.paths.some((path) => (
    isRecord(path) && isRecord(path.constraints) && path.constraints.maxAngDecel === 0
  ));
  return hasMissingPathId || "routine" in value || hasInvalidRoutineState || hasNumericReference
    || hasInvalidPlanner || hasLegacyAngularDeceleration;
}

function validatedProject(value: unknown, migrated: boolean): DecodedProjectFile {
  const project = normalizeProject(value);
  const validation = validateProject(project);
  if (!validation.ok) {
    const message = validation.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
    throw new Error(`Invalid Bordeaux project:\n${message}`);
  }
  return { project: project as BordeauxProject, migrated };
}

export function decodeProjectValue(value: unknown): DecodedProjectFile {
  if (!isRecord(value)) return validatedProject(value, false);

  if (value.schemaVersion !== undefined) {
    if (value.schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Bordeaux project schema version ${JSON.stringify(value.schemaVersion)}. ` +
        `This version of Bordeaux supports ${CURRENT_PROJECT_SCHEMA_VERSION}.`,
      );
    }
    return validatedProject(value, needsV1Migration(value));
  }

  if (Array.isArray(value.paths)) {
    return validatedProject(
      { ...value, schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION },
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
        plannerId: "profiledSpline",
      },
      true,
    );
  }

  return validatedProject(value, false);
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
