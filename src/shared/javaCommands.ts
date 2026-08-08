import type {
  BordeauxProject,
  CommandArgumentValue,
  CommandInvocation,
  JavaCommandCatalog,
  JavaCommandDescriptor,
  JavaCommandParameter,
  JavaValueSchema,
  RoutineNode,
  ValidationIssue,
} from "./types";

const MAX_SCHEMA_DEPTH = 24;
const MAX_ARRAY_ITEMS = 1_024;
const MAX_MAP_ENTRIES = 256;

function simpleJavaType(javaType: string): string {
  return javaType.split(".").at(-1) ?? javaType;
}

function integerRange(javaType: string): readonly [number, number] | null {
  const simple = simpleJavaType(javaType);
  if (simple === "byte" || simple === "Byte") return [-128, 127];
  if (simple === "short" || simple === "Short") return [-32768, 32767];
  if (simple === "int" || simple === "Integer") return [-2147483648, 2147483647];
  return null;
}

function exactIntegerError(value: unknown, javaType: string): string | null {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return "must be a whole number written as digits";
  if (value.length > 1_024) return "cannot exceed 1024 characters";
  const simple = simpleJavaType(javaType);
  if (simple === "long" || simple === "Long") {
    const parsed = BigInt(value);
    if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) return "must fit the signed 64-bit long range";
  }
  return null;
}

function exactDecimalError(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return "must be a decimal number written as text";
  }
  if (value.length > 1_024) return "cannot exceed 1024 characters";
  const exponent = /[eE]([+-]?\d+)$/.exec(value);
  if (exponent && Math.abs(Number(exponent[1])) > 10_000) return "exponent cannot exceed 10000 in magnitude";
  return null;
}

export function compareExactDecimals(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
    if (!match) throw new Error("Invalid exact decimal");
    const fraction = match[3] ?? match[4] ?? "";
    const rawDigits = `${match[2] ?? "0"}${fraction}`.replace(/^0+/, "") || "0";
    const exponent = Number(match[5] ?? 0) - fraction.length;
    return { sign: rawDigits === "0" ? 0 : match[1] === "-" ? -1 : 1, digits: rawDigits, exponent };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  const aPower = a.digits.length + a.exponent;
  const bPower = b.digits.length + b.exponent;
  let magnitude = aPower === bPower ? 0 : aPower < bPower ? -1 : 1;
  if (magnitude === 0) {
    const length = Math.max(a.digits.length, b.digits.length);
    for (let index = 0; index < length; index += 1) {
      const aDigit = a.digits[index] ?? "0";
      const bDigit = b.digits[index] ?? "0";
      if (aDigit !== bDigit) {
        magnitude = aDigit < bDigit ? -1 : 1;
        break;
      }
    }
  }
  return a.sign < 0 ? -magnitude : magnitude;
}

export function javaSchemaValueError(value: unknown, schema: JavaValueSchema, valuePath = "Value", depth = 0): string | null {
  if (depth > MAX_SCHEMA_DEPTH) return `${valuePath} exceeds the supported nesting depth`;
  if (value === undefined) return `${valuePath} is required`;
  if (schema.kind === "opaque") return isJsonValue(value, depth) ? null : `${valuePath} must be JSON-compatible`;
  if (schema.kind === "optional") return value === null ? null : javaSchemaValueError(value, schema.element!, valuePath, depth + 1);
  if (schema.kind === "boolean") return typeof value === "boolean" ? null : `${valuePath} must be true or false`;
  if (schema.kind === "integer") {
    if (!Number.isSafeInteger(value)) return `${valuePath} must be a safe whole number`;
    const range = integerRange(schema.javaType);
    return !range || ((value as number) >= range[0] && (value as number) <= range[1]) ? null : `${valuePath} is outside the range for ${schema.javaType}`;
  }
  if (schema.kind === "integerString") {
    const error = exactIntegerError(value, schema.javaType);
    return error ? `${valuePath} ${error}` : null;
  }
  if (schema.kind === "decimalString") {
    const error = exactDecimalError(value);
    return error ? `${valuePath} ${error}` : null;
  }
  if (schema.kind === "number") return typeof value === "number" && Number.isFinite(value) ? null : `${valuePath} must be a finite number`;
  if (schema.kind === "string") return typeof value === "string" ? null : `${valuePath} must be text`;
  if (schema.kind === "enum") return typeof value === "string" && (schema.enumValues ?? []).includes(value) ? null : `${valuePath} must be one of the discovered enum values`;
  if (schema.kind === "array") {
    if (!Array.isArray(value)) return `${valuePath} must be a JSON array`;
    if (value.length > MAX_ARRAY_ITEMS) return `${valuePath} cannot contain more than ${MAX_ARRAY_ITEMS} items`;
    for (let index = 0; index < value.length; index += 1) {
      const error = javaSchemaValueError(value[index], schema.element!, `${valuePath}[${index}]`, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (schema.kind === "map") {
    if (!isObject(value)) return `${valuePath} must be a JSON object with string keys`;
    if (Object.keys(value).length > MAX_MAP_ENTRIES) return `${valuePath} cannot contain more than ${MAX_MAP_ENTRIES} entries`;
    for (const [key, item] of Object.entries(value)) {
      const error = javaSchemaValueError(item, schema.value!, `${valuePath}.${key}`, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (schema.kind === "object") {
    if (!isObject(value)) return `${valuePath} must be a JSON object`;
    const fields = schema.fields ?? [];
    const names = new Set(fields.map((field) => field.name));
    const extra = Object.keys(value).find((key) => !names.has(key));
    if (extra) return `${valuePath}.${extra} is not part of the discovered type`;
    for (const field of fields) {
      const error = javaSchemaValueError(value[field.name], field.schema, `${valuePath}.${field.name}`, depth + 1);
      if (error) return error;
    }
    return null;
  }
  return `${valuePath} uses an unsupported parameter schema`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_SCHEMA_DEPTH) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= MAX_ARRAY_ITEMS && value.every((item) => isJsonValue(item, depth + 1));
  return isObject(value) && Object.keys(value).length <= MAX_MAP_ENTRIES && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function defaultJavaSchemaValue(schema: JavaValueSchema, depth = 0): CommandArgumentValue {
  if (depth > MAX_SCHEMA_DEPTH) return null;
  if (schema.kind === "boolean") return false;
  if (schema.kind === "integer" || schema.kind === "number") return 0;
  if (schema.kind === "integerString" || schema.kind === "decimalString") return "0";
  if (schema.kind === "string") return "";
  if (schema.kind === "enum") return schema.enumValues?.[0] ?? "";
  if (schema.kind === "array") return [];
  if (schema.kind === "map" || schema.kind === "opaque") return {};
  if (schema.kind === "optional") return null;
  if (schema.kind === "object") {
    return Object.fromEntries((schema.fields ?? []).map((field) => [field.name, defaultJavaSchemaValue(field.schema, depth + 1)]));
  }
  return null;
}

export function defaultJavaCommandArguments(command: JavaCommandDescriptor): Record<string, CommandArgumentValue> {
  return Object.fromEntries(command.parameters
    .filter((parameter) => parameter.role === "argument")
    .map((parameter) => [
      parameter.name,
      Object.hasOwn(parameter, "defaultValue") ? parameter.defaultValue! : defaultJavaSchemaValue(parameter.schema),
    ]));
}

function parameterLimitError(value: CommandArgumentValue, parameter: JavaCommandParameter): string | null {
  if (parameter.min === undefined && parameter.max === undefined) return null;
  if (parameter.schema.kind === "integerString" && typeof value === "string" && /^[+-]?\d+$/.test(value)) {
    const comparable = BigInt(value);
    if (parameter.min !== undefined && comparable < BigInt(parameter.min)) return `${parameter.name} must be at least ${parameter.min}`;
    if (parameter.max !== undefined && comparable > BigInt(parameter.max)) return `${parameter.name} must be at most ${parameter.max}`;
    return null;
  }
  if (parameter.schema.kind === "decimalString" && typeof value === "string") {
    if (parameter.min !== undefined && compareExactDecimals(value, String(parameter.min)) < 0) return `${parameter.name} must be at least ${parameter.min}`;
    if (parameter.max !== undefined && compareExactDecimals(value, String(parameter.max)) > 0) return `${parameter.name} must be at most ${parameter.max}`;
    return null;
  }
  let comparable: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) comparable = value;
  else if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) comparable = Number(value);
  if (comparable === null || !Number.isFinite(comparable)) return null;
  if (parameter.min !== undefined && comparable < Number(parameter.min)) return `${parameter.name} must be at least ${parameter.min}`;
  if (parameter.max !== undefined && comparable > Number(parameter.max)) return `${parameter.name} must be at most ${parameter.max}`;
  return null;
}

export function javaParameterValueError(value: unknown, parameter: JavaCommandParameter): string | null {
  const schemaError = javaSchemaValueError(value, parameter.schema, parameter.label || parameter.name);
  return schemaError ?? parameterLimitError(value as CommandArgumentValue, parameter);
}

export function javaInvocationErrors(invocation: CommandInvocation, command: JavaCommandDescriptor): string[] {
  const errors: string[] = [];
  if (command.runtimeReady !== true) errors.push(`${command.label} has no generated robot binding; build the annotated catalog first`);
  const parameters = command.parameters.filter((parameter) => parameter.role === "argument");
  const names = new Set(parameters.map((parameter) => parameter.name));
  for (const name of Object.keys(invocation.arguments)) {
    if (!names.has(name)) errors.push(`${name} is not a parameter of ${command.label}`);
  }
  for (const parameter of parameters) {
    const value = invocation.arguments[parameter.name];
    const error = javaParameterValueError(value, parameter);
    if (error) errors.push(error);
  }
  return errors;
}

export function validateProjectJavaInvocations(project: BordeauxProject, catalog: JavaCommandCatalog | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const commands = new Map((catalog?.commands ?? []).map((command) => [command.id, command]));
  project.paths.forEach((path, pathIndex) => path.markers.forEach((marker, markerIndex) => {
    const base = `$.paths[${pathIndex}].markers[${markerIndex}]`;
    if (marker.actionIntent && !marker.invocation) {
      issues.push({ path: `${base}.actionIntent`, message: `Action ${marker.actionIntent.semanticTag} is still an intent; bind it to a generated Java command before export`, severity: "error" });
      return;
    }
    if (!marker.invocation && marker.cmd && marker.cmd !== "none") {
      issues.push({ path: `${base}.cmd`, message: `Legacy command ${marker.cmd} must be replaced with a generated Java invocation before export`, severity: "error" });
      return;
    }
    if (!marker.invocation) return;
    const invocationBase = `${base}.invocation`;
    const command = commands.get(marker.invocation.commandId);
    if (!command) {
      issues.push({ path: `${invocationBase}.commandId`, message: `Command ${marker.invocation.commandId} is not in the linked generated catalog`, severity: "error" });
      return;
    }
    if (marker.actionIntent && !command.semanticTags?.includes(marker.actionIntent.semanticTag)) {
      issues.push({
        path: `${base}.actionIntent`,
        message: `Command ${command.label} does not advertise the required ${marker.actionIntent.semanticTag} capability`,
        severity: "error",
      });
    }
    for (const message of javaInvocationErrors(marker.invocation, command)) {
      issues.push({ path: invocationBase, message, severity: "error" });
    }
  }));
  const validateRoutineNodes = (nodes: RoutineNode[], path: string) => {
    nodes.forEach((value, index) => {
      const node = value;
      const base = `${path}[${index}]`;
      if (node.type === "decision") {
        validateRoutineNodes(node.then, `${base}.then`);
        validateRoutineNodes(node.else, `${base}.else`);
      } else if (node.type === "function" && node.cat === "command") {
        if (!node.invocation) {
          issues.push({ path: `${base}.invocation`, message: "Between-path command must be bound before export", severity: "error" });
          return;
        }
        const command = commands.get(node.invocation.commandId);
        if (!command) {
          issues.push({ path: `${base}.invocation.commandId`, message: `Command ${node.invocation.commandId} is not in the linked generated catalog`, severity: "error" });
          return;
        }
        javaInvocationErrors(node.invocation, command).forEach((message) =>
          issues.push({ path: `${base}.invocation`, message, severity: "error" }));
      }
    });
  };
  if (project.routine) validateRoutineNodes(project.routine.nodes, "$.routine.nodes");
  return issues;
}
