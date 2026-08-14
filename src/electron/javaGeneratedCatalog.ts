import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { compareExactDecimals, javaParameterValueError } from "../shared/javaCommands";
import type { JavaBuiltInDescriptor, JavaCommandDescriptor, JavaCommandParameter, JavaConditionDescriptor, JavaValueSchema } from "../shared/types";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_COMMANDS = 5_000;
const MAX_CONDITIONS = 5_000;
const MAX_PARAMETERS = 256;
const MAX_SCHEMA_DEPTH = 24;
const MAX_OBJECT_FIELDS = 256;
const MAX_ENUM_VALUES = 1_024;

interface GeneratedJavaCatalog {
  schemaVersion: "1.0" | "1.1" | "1.2";
  catalogId: string;
  supportVersion: string;
  catalogHash: string;
  commands: JavaCommandDescriptor[];
  conditions: JavaConditionDescriptor[];
  builtIns: JavaBuiltInDescriptor[];
}

const BORDEAUX_WAIT: JavaBuiltInDescriptor = {
  id: "bordeaux.wait",
  kind: "wait",
  label: "Wait",
  description: "Pause the routine before its next step.",
  parameters: [{
    name: "durationS",
    label: "Duration",
    description: "Time to wait before continuing the routine.",
    unit: "s",
    defaultValue: 1,
    min: 0.02,
    max: 15,
    role: "argument",
    javaType: "double",
    schema: { kind: "number", javaType: "double" },
  }],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`Generated Java catalog ${label} is invalid`);
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label, maxLength);
}

function optionalTerms(value: unknown, label: string, kebabCase = false): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) throw new Error(`Generated Java catalog ${label} is invalid`);
  const terms = value.map((item) => text(item, label, 64));
  const normalized = terms.map((item) => item.toLocaleLowerCase("en-US"));
  if (new Set(normalized).size !== terms.length || (kebabCase && terms.some((item) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item)))) {
    throw new Error(`Generated Java catalog ${label} is invalid`);
  }
  return terms;
}

function finiteOptional(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Generated Java catalog ${label} must be finite`);
  return value;
}

function exactBound(value: unknown, label: string, integer: boolean): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 128) throw new Error(`Generated Java catalog ${label} must be a bounded exact decimal string`);
  const pattern = integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(value)) throw new Error(`Generated Java catalog ${label} is not a valid exact ${integer ? "integer" : "decimal"}`);
  const exponent = /[eE]([+-]?\d+)$/.exec(value);
  if (exponent && Math.abs(Number(exponent[1])) > 10_000) throw new Error(`Generated Java catalog ${label} exponent is too large`);
  return value;
}

function parseSchema(raw: unknown, depth = 0): JavaValueSchema {
  if (depth > MAX_SCHEMA_DEPTH) throw new Error(`Generated Java catalog schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  const value = record(raw);
  if (!value) throw new Error("Generated Java catalog parameter schema must be an object");
  const kind = text(value.kind, "schema kind", 32) as JavaValueSchema["kind"];
  if (!["boolean", "integer", "integerString", "decimalString", "number", "string", "enum", "array", "map", "optional", "object", "opaque"].includes(kind)) {
    throw new Error(`Generated Java catalog schema kind ${kind} is unsupported`);
  }
  if (kind === "opaque") throw new Error("Generated robot bindings cannot expose opaque parameter schemas");
  const schema: JavaValueSchema = { kind, javaType: text(value.javaType, "Java type", 512) };
  if (kind === "enum") {
    if (!Array.isArray(value.enumValues) || value.enumValues.length === 0 || value.enumValues.length > MAX_ENUM_VALUES) throw new Error("Generated Java catalog enum values are invalid");
    schema.enumValues = value.enumValues.map((item) => text(item, "enum value", 256));
  }
  if (kind === "array" || kind === "optional") schema.element = parseSchema(value.element, depth + 1);
  if (kind === "map") schema.value = parseSchema(value.value, depth + 1);
  if (kind === "object") {
    if (!Array.isArray(value.fields) || value.fields.length > MAX_OBJECT_FIELDS) throw new Error("Generated Java catalog object fields are invalid");
    const names = new Set<string>();
    schema.fields = value.fields.map((rawField) => {
      const field = record(rawField);
      if (!field) throw new Error("Generated Java catalog object field must be an object");
      const name = text(field.name, "field name", 256);
      if (names.has(name)) throw new Error(`Generated Java catalog object field ${name} is duplicated`);
      names.add(name);
      return { name, schema: parseSchema(field.schema, depth + 1) };
    });
  }
  return schema;
}

function parseParameter(raw: unknown): JavaCommandParameter {
  const value = record(raw);
  if (!value) throw new Error("Generated Java catalog parameter must be an object");
  const role = text(value.role, "parameter role", 32);
  if (role !== "argument" && role !== "dependency") throw new Error(`Generated Java catalog parameter role ${role} is unsupported`);
  const parameter: JavaCommandParameter = {
    name: text(value.name, "parameter name", 256),
    javaType: text(value.javaType, "parameter Java type", 512),
    role,
    schema: parseSchema(value.schema),
  };
  parameter.label = optionalText(value.label, "parameter label", 256);
  parameter.description = optionalText(value.description, "parameter description", 2_048);
  parameter.unit = optionalText(value.unit, "parameter unit", 64);
  const exact = parameter.schema.kind === "integerString" || parameter.schema.kind === "decimalString";
  parameter.min = exact ? exactBound(value.min, "parameter minimum", parameter.schema.kind === "integerString") : finiteOptional(value.min, "parameter minimum");
  parameter.max = exact ? exactBound(value.max, "parameter maximum", parameter.schema.kind === "integerString") : finiteOptional(value.max, "parameter maximum");
  if (typeof parameter.min === "number" && typeof parameter.max === "number" && parameter.min > parameter.max) throw new Error(`Generated Java catalog parameter ${parameter.name} has an inverted range`);
  if (typeof parameter.min === "string" && typeof parameter.max === "string" && compareExactDecimals(parameter.min, parameter.max) > 0) {
    throw new Error(`Generated Java catalog parameter ${parameter.name} has an inverted range`);
  }
  if (Object.hasOwn(value, "defaultValue")) {
    const error = javaParameterValueError(value.defaultValue, parameter);
    if (error) throw new Error(`Generated Java catalog default ${error}`);
    parameter.defaultValue = value.defaultValue as JavaCommandParameter["defaultValue"];
  }
  return parameter;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value);
  if (!object) throw new Error("Generated Java catalog hash input is not JSON-compatible");
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function generatedCatalogHash(commands: unknown, conditions?: unknown, builtIns?: unknown): string {
  const input = builtIns === undefined
    ? conditions === undefined ? commands : { commands, conditions }
    : { builtIns, commands, conditions };
  return `sha256:${createHash("sha256").update(canonicalJson(input), "utf8").digest("hex")}`;
}

export function parseGeneratedJavaCatalog(raw: unknown): GeneratedJavaCatalog {
  const value = record(raw);
  const schemaVersion = value?.schemaVersion;
  if (!value || (schemaVersion !== "1.0" && schemaVersion !== "1.1" && schemaVersion !== "1.2") || !Array.isArray(value.commands) || value.commands.length > MAX_COMMANDS) {
    throw new Error("Generated Java catalog must use schema version 1.0, 1.1, or 1.2 and contain a bounded commands array");
  }
  const supportVersion = text(value.supportVersion, "support version", 64);
  if (!((schemaVersion === "1.0" && supportVersion === "0.1.0") || (schemaVersion === "1.1" && supportVersion === "0.2.0") || (schemaVersion === "1.2" && supportVersion === "0.3.0"))) {
    throw new Error(`Generated Java catalog schema ${schemaVersion} requires its matching supported runtime version`);
  }
  const catalogId = text(value.catalogId, "catalog ID", 256);
  const catalogHash = text(value.catalogHash, "catalog hash", 96);
  if (!/^sha256:[0-9a-f]{64}$/.test(catalogHash)) throw new Error("Generated Java catalog hash is invalid");
  if (schemaVersion === "1.0" && value.conditions !== undefined) throw new Error("Legacy generated Java catalog 1.0 cannot declare conditions");
  if ((schemaVersion === "1.1" || schemaVersion === "1.2") && (!Array.isArray(value.conditions) || value.conditions.length > MAX_CONDITIONS)) {
    throw new Error(`Generated Java catalog ${schemaVersion} must contain a bounded conditions array`);
  }
  if (schemaVersion !== "1.2" && value.builtIns !== undefined) throw new Error("Generated Java catalog built-ins require schema 1.2");
  if (schemaVersion === "1.2" && (!Array.isArray(value.builtIns) || canonicalJson(value.builtIns) !== canonicalJson([BORDEAUX_WAIT]))) {
    throw new Error("Generated Java catalog 1.2 must declare the exact Bordeaux-owned built-in capabilities");
  }
  const rawConditions = schemaVersion === "1.0" ? [] : value.conditions as unknown[];
  const rawBuiltIns = schemaVersion === "1.2" ? value.builtIns as unknown[] : [];
  const expectedHash = schemaVersion === "1.0"
    ? generatedCatalogHash(value.commands)
    : schemaVersion === "1.1"
      ? generatedCatalogHash(value.commands, rawConditions)
      : generatedCatalogHash(value.commands, rawConditions, rawBuiltIns);
  if (catalogHash !== expectedHash) throw new Error("Generated Java catalog hash does not match its declared capabilities");
  const ids = new Set<string>();
  const commands = value.commands.map((rawCommand) => {
    const command = record(rawCommand);
    if (!command) throw new Error("Generated Java catalog command must be an object");
    const id = text(command.id, "command ID", 256);
    if (!/^[A-Za-z0-9_.:#()$,-]+$/.test(id)) throw new Error(`Generated Java catalog command ID ${id} contains unsupported characters`);
    if (ids.has(id)) throw new Error(`Generated Java catalog command ID ${id} is duplicated`);
    ids.add(id);
    const kind = text(command.kind, "command kind", 32) as JavaCommandDescriptor["kind"];
    if (kind !== "factory" && kind !== "constructor") throw new Error(`Generated Java catalog command kind ${kind} is unsupported`);
    const confidence = text(command.confidence, "command confidence", 32) as JavaCommandDescriptor["confidence"];
    if (confidence !== "confirmed" && confidence !== "inferred") throw new Error(`Generated Java catalog command confidence ${confidence} is unsupported`);
    if (!Array.isArray(command.parameters) || command.parameters.length > MAX_PARAMETERS) throw new Error(`Generated Java catalog command ${id} has too many parameters`);
    const parameterNames = new Set<string>();
    const parameters = command.parameters.map((item) => {
      const parameter = parseParameter(item);
      if (parameterNames.has(parameter.name)) throw new Error(`Generated Java catalog command ${id} duplicates parameter ${parameter.name}`);
      parameterNames.add(parameter.name);
      return parameter;
    });
    const source = record(command.source);
    const sourceFile = source && typeof source.file === "string" && source.file.length <= 1_024 ? source.file : "generated by Bordeaux annotation processor";
    if (path.isAbsolute(sourceFile) || sourceFile.split(/[\\/]/).includes("..")) throw new Error(`Generated Java catalog source path ${sourceFile} must be relative`);
    return {
      id,
      label: text(command.label, "command label", 256),
      description: optionalText(command.description, "command description", 2_048),
      aliases: optionalTerms(command.aliases, "command aliases"),
      semanticTags: optionalTerms(command.semanticTags, "command semantic tags", true),
      ownerType: text(command.ownerType, "command owner", 512),
      member: text(command.member, "command member", 256),
      kind,
      confidence,
      runtimeReady: true,
      parameters,
      source: {
        file: sourceFile,
        line: source && Number.isInteger(source.line) && (source.line as number) > 0 ? source.line as number : 1,
      },
    };
  });
  const conditionIds = new Set<string>();
  let previousConditionId: string | null = null;
  const conditions: JavaConditionDescriptor[] = schemaVersion !== "1.0"
    ? rawConditions.map((rawCondition) => {
      const condition = record(rawCondition);
      if (!condition) throw new Error("Generated Java catalog condition must be an object");
      const id = text(condition.id, "condition ID", 256);
      if (!/^[A-Za-z0-9_.:#()$,-]+$/.test(id)) throw new Error(`Generated Java catalog condition ID ${id} contains unsupported characters`);
      if (conditionIds.has(id)) throw new Error(`Generated Java catalog condition ID ${id} is duplicated`);
      if (ids.has(id)) throw new Error(`Generated Java catalog capability ID ${id} collides across commands and conditions`);
      if (previousConditionId !== null && id <= previousConditionId) throw new Error("Generated Java catalog conditions must be sorted by ID");
      conditionIds.add(id);
      previousConditionId = id;
      const source = record(condition.source);
      if (!source) throw new Error(`Generated Java catalog condition ${id} source is invalid`);
      const sourceFile = text(source.file, "condition source path", 1_024);
      if (path.isAbsolute(sourceFile) || sourceFile.split(/[\\/]/).includes("..")) throw new Error(`Generated Java catalog condition source path ${sourceFile} must be relative`);
      if (!Number.isInteger(source.line) || (source.line as number) < 0) throw new Error(`Generated Java catalog condition ${id} source line is invalid`);
      return {
        id,
        label: text(condition.label, "condition label", 256),
        description: optionalText(condition.description, "condition description", 2_048),
        aliases: optionalTerms(condition.aliases, "condition aliases"),
        semanticTags: optionalTerms(condition.semanticTags, "condition semantic tags", true),
        ownerType: text(condition.ownerType, "condition owner", 512),
        member: text(condition.member, "condition member", 256),
        source: { file: sourceFile, line: (source.line as number) > 0 ? source.line as number : 1 },
      };
    })
    : [];
  return {
    schemaVersion,
    catalogId,
    supportVersion,
    catalogHash,
    commands,
    conditions,
    builtIns: schemaVersion === "1.2"
      ? [{ ...BORDEAUX_WAIT, parameters: [{ ...BORDEAUX_WAIT.parameters[0], schema: { ...BORDEAUX_WAIT.parameters[0].schema } }] }]
      : [],
  };
}

export async function readGeneratedJavaCatalog(projectRoot: string): Promise<GeneratedJavaCatalog | null> {
  const relativePath = "build/bordeaux/catalog-v1.json";
  const filePath = path.join(projectRoot, relativePath);
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Generated Java catalog ${relativePath} must be a regular file`);
  if (stat.size > MAX_CATALOG_BYTES) throw new Error(`Generated Java catalog exceeds ${MAX_CATALOG_BYTES} bytes`);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Generated Java catalog ${relativePath} is not valid JSON`, { cause: error });
  }
  return parseGeneratedJavaCatalog(raw);
}
