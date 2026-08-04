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
    }
  });

  return { ok: issues.every((x) => x.severity !== "error"), issues };
}
