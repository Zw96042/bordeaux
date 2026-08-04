import type { ValidationIssue, ValidationResult } from "./types";
import { FIELD_H, FIELD_W } from "./math/fieldBounds";

type RecordValue = Record<string, unknown>;

function issue(path: string, message: string, severity: "error" | "warning" = "error"): ValidationIssue {
  return { path, message, severity };
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateFinite(issues: ValidationIssue[], value: unknown, path: string, label: string, options: { positive?: boolean; nonnegative?: boolean } = {}) {
  if (!finite(value)) {
    issues.push(issue(path, `${label} must be a finite number`));
  } else if (options.positive && value <= 0) {
    issues.push(issue(path, `${label} must be greater than zero`));
  } else if (options.nonnegative && value < 0) {
    issues.push(issue(path, `${label} cannot be negative`));
  }
}

function validateOptionalFinite(issues: ValidationIssue[], value: unknown, path: string, label: string, options: { positive?: boolean; nonnegative?: boolean } = {}) {
  if (value !== undefined) validateFinite(issues, value, path, label, options);
}

function validatePoint(issues: ValidationIssue[], value: unknown, path: string, label: string) {
  if (!isRecord(value)) {
    issues.push(issue(path, `${label} is required`));
    return;
  }
  validateFinite(issues, value.x, `${path}.x`, `${label} X`);
  validateFinite(issues, value.y, `${path}.y`, `${label} Y`);
}

function validateRobotFootprint(issues: ValidationIssue[], robot: RecordValue): void {
  if (robot.footprint === undefined) return;
  const path = "$.robot.footprint";
  if (!isRecord(robot.footprint)) {
    issues.push(issue(path, "Robot footprint must be an object"));
    return;
  }
  if (robot.footprint.kind !== "polygon") issues.push(issue(`${path}.kind`, "Robot footprint kind must be polygon"));
  const vertices = robot.footprint.verticesM;
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > 16) {
    issues.push(issue(`${path}.verticesM`, "Robot footprint must contain between 3 and 16 vertices"));
    return;
  }
  const points = vertices.flatMap((vertex, index) => {
    if (!isRecord(vertex) || !finite(vertex.x) || !finite(vertex.y)) {
      issues.push(issue(`${path}.verticesM[${index}]`, "Robot footprint vertices must contain finite X and Y coordinates"));
      return [];
    }
    return [{ x: vertex.x, y: vertex.y }];
  });
  if (points.length !== vertices.length) return;

  const crosses = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const after = points[(index + 2) % points.length];
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  }).filter((value) => Math.abs(value) > 1e-9);
  if (crosses.length === 0 || crosses.some((value) => Math.sign(value) !== Math.sign(crosses[0]))) {
    issues.push(issue(`${path}.verticesM`, "Robot footprint must be a non-self-intersecting convex polygon"));
    return;
  }
  const winding = Math.sign(crosses[0]);
  const containsOrigin = points.every((point, index) => {
    const next = points[(index + 1) % points.length];
    const originCross = (next.x - point.x) * -point.y - (next.y - point.y) * -point.x;
    return Math.abs(originCross) <= 1e-9 || Math.sign(originCross) === winding;
  });
  if (!containsOrigin) issues.push(issue(`${path}.verticesM`, "Robot footprint must contain the robot reference point at (0, 0)"));

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  if (finite(robot.l) && maxX - minX > robot.l + 1e-6) issues.push(issue(`${path}.verticesM`, "Robot footprint forward extent cannot exceed robot length"));
  if (finite(robot.w) && maxY - minY > robot.w + 1e-6) issues.push(issue(`${path}.verticesM`, "Robot footprint lateral extent cannot exceed robot width"));
}

function validateRobotPlanning(issues: ValidationIssue[], robot: RecordValue): void {
  if (robot.planning === undefined) return;
  const path = "$.robot.planning";
  if (!isRecord(robot.planning)) {
    issues.push(issue(path, "Robot planning profile must be an object"));
    return;
  }
  const planning = robot.planning;
  if (planning.notes !== undefined && (typeof planning.notes !== "string" || planning.notes.length > 4_000)) {
    issues.push(issue(`${path}.notes`, "Robot planning notes must be text no longer than 4,000 characters"));
  }
  if (planning.intake !== undefined) {
    const intakePath = `${path}.intake`;
    if (!isRecord(planning.intake)) issues.push(issue(intakePath, "Intake profile must be an object"));
    else {
      if (typeof planning.intake.name !== "string" || !planning.intake.name.trim() || planning.intake.name.length > 80) issues.push(issue(`${intakePath}.name`, "Intake name must contain 1 to 80 characters"));
      validatePoint(issues, planning.intake.centerM, `${intakePath}.centerM`, "Intake center");
      validateFinite(issues, planning.intake.directionDeg, `${intakePath}.directionDeg`, "Intake direction");
      validateFinite(issues, planning.intake.captureWidthM, `${intakePath}.captureWidthM`, "Intake capture width", { positive: true });
      validateFinite(issues, planning.intake.maxCollectSpeedMps, `${intakePath}.maxCollectSpeedMps`, "Maximum collection speed", { positive: true });
      if (finite(planning.intake.directionDeg) && Math.abs(planning.intake.directionDeg) > 180) issues.push(issue(`${intakePath}.directionDeg`, "Intake direction must be between -180 and 180 degrees"));
      if (finite(planning.intake.captureWidthM) && planning.intake.captureWidthM > 3) issues.push(issue(`${intakePath}.captureWidthM`, "Intake capture width cannot exceed 3 m"));
      if (finite(planning.intake.maxCollectSpeedMps) && finite(robot.maxSpeed) && planning.intake.maxCollectSpeedMps > robot.maxSpeed + 1e-9) {
        issues.push(issue(`${intakePath}.maxCollectSpeedMps`, "Maximum collection speed cannot exceed robot max speed"));
      }
    }
  }
  if (planning.shooter !== undefined) {
    const shooterPath = `${path}.shooter`;
    if (!isRecord(planning.shooter)) issues.push(issue(shooterPath, "Shooter profile must be an object"));
    else {
      validateFinite(issues, planning.shooter.directionDeg, `${shooterPath}.directionDeg`, "Shooter direction");
      if (finite(planning.shooter.directionDeg) && Math.abs(planning.shooter.directionDeg) > 180) issues.push(issue(`${shooterPath}.directionDeg`, "Shooter direction must be between -180 and 180 degrees"));
      if (typeof planning.shooter.requiresTargetFacing !== "boolean") issues.push(issue(`${shooterPath}.requiresTargetFacing`, "Shooter target-facing setting must be true or false"));
      validateOptionalFinite(issues, planning.shooter.preferredRangeM, `${shooterPath}.preferredRangeM`, "Preferred shooting range", { positive: true });
    }
  }
}

function validateCommandArgumentValue(issues: ValidationIssue[], value: unknown, path: string, depth = 0): void {
  if (depth > 24) {
    issues.push(issue(path, "Command argument nesting cannot exceed 24 levels"));
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(issue(path, "Command argument numbers must be finite"));
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1024) {
      issues.push(issue(path, "Command argument arrays cannot exceed 1024 items"));
      return;
    }
    value.forEach((item, index) => validateCommandArgumentValue(issues, item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 256) {
      issues.push(issue(path, "Command argument objects cannot exceed 256 fields"));
      return;
    }
    entries.forEach(([key, item]) => validateCommandArgumentValue(issues, item, `${path}.${key}`, depth + 1));
    return;
  }
  issues.push(issue(path, "Command arguments must contain only JSON-compatible values"));
}

function validateRoutineNodes(issues: ValidationIssue[], value: unknown, path: string, pathIds: Set<string>, nodeIds: Set<string>) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "Routine nodes must be an array"));
    return;
  }
  value.forEach((node, index) => {
    const base = `${path}[${index}]`;
    if (!isRecord(node)) {
      issues.push(issue(base, "Routine node must be an object"));
      return;
    }
    if (typeof node.id !== "string" || !node.id.trim()) issues.push(issue(`${base}.id`, "Routine node ID is required"));
    else if (nodeIds.has(node.id)) issues.push(issue(`${base}.id`, "Routine node IDs must be unique"));
    else nodeIds.add(node.id);

    if (node.type === "path") {
      if (typeof node.ref !== "string" || !pathIds.has(node.ref)) issues.push(issue(`${base}.ref`, "Routine path reference must match a path ID"));
      return;
    }
    if (node.type === "decision") {
      if (typeof node.cond !== "string") issues.push(issue(`${base}.cond`, "Decision condition is required"));
      if (typeof node.thenLabel !== "string" || typeof node.elseLabel !== "string") issues.push(issue(base, "Decision branch labels are required"));
      validateRoutineNodes(issues, node.then, `${base}.then`, pathIds, nodeIds);
      validateRoutineNodes(issues, node.else, `${base}.else`, pathIds, nodeIds);
      return;
    }
    if (node.type !== "function") {
      issues.push(issue(`${base}.type`, "Routine node type is invalid"));
      return;
    }
    if (!["terminate", "sequence", "generate", "velocity"].includes(String(node.cat))) issues.push(issue(`${base}.cat`, "Routine function category is invalid"));
    validateOptionalFinite(issues, node.scale, `${base}.scale`, "Velocity scale", { nonnegative: true });
  });
}

function validateProjectInner(project: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(project)) return { ok: false, issues: [issue("$", "Project must be a JSON object")] };

  if (project.schemaVersion !== "1.0") issues.push(issue("$.schemaVersion", "Schema version must be 1.0"));
  if (typeof project.name !== "string" || !project.name.trim()) issues.push(issue("$.name", "Project name is required"));
  if (project.plannerId !== undefined && !["profiledSpline", "optimizedTrajectory", "labviewBezier", "labviewClothoid"].includes(String(project.plannerId))) {
    issues.push(issue("$.plannerId", "Planner must be profiledSpline, optimizedTrajectory, labviewBezier, or labviewClothoid"));
  }

  if (!isRecord(project.robot)) {
    issues.push(issue("$.robot", "Robot config is required"));
  } else {
    if (project.robot.drive !== "swerve" && project.robot.drive !== "tank") issues.push(issue("$.robot.drive", "Drive must be swerve or tank"));
    validateFinite(issues, project.robot.w, "$.robot.w", "Robot width", { positive: true });
    validateFinite(issues, project.robot.l, "$.robot.l", "Robot length", { positive: true });
    validateOptionalFinite(issues, project.robot.heightM, "$.robot.heightM", "Robot height", { positive: true });
    validateFinite(issues, project.robot.maxSpeed, "$.robot.maxSpeed", "Robot max speed", { positive: true });
    validateRobotFootprint(issues, project.robot);
    validateRobotPlanning(issues, project.robot);
  }

  const pathIds = new Set<string>();
  const markerIds = new Set<string>();
  const folderIds = new Set<string>();
  if (project.pathFolders !== undefined) {
    if (!Array.isArray(project.pathFolders)) issues.push(issue("$.pathFolders", "Path folders must be an array"));
    else project.pathFolders.forEach((folder, index) => {
      const base = `$.pathFolders[${index}]`;
      if (!isRecord(folder)) { issues.push(issue(base, "Path folder must be an object")); return; }
      if (typeof folder.id !== "string" || !folder.id.trim()) issues.push(issue(`${base}.id`, "Folder ID is required"));
      else if (folderIds.has(folder.id)) issues.push(issue(`${base}.id`, "Folder IDs must be unique"));
      else folderIds.add(folder.id);
      if (typeof folder.name !== "string" || !folder.name.trim()) issues.push(issue(`${base}.name`, "Folder name is required"));
    });
  }
  if (!Array.isArray(project.paths)) {
    issues.push(issue("$.paths", "Project paths must be an array"));
  } else if (project.paths.length === 0) {
