import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { compareExactDecimals, javaParameterValueError } from "../shared/javaCommands";
import type { JavaCommandDescriptor, JavaCommandParameter, JavaValueSchema } from "../shared/types";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_COMMANDS = 5_000;
const MAX_PARAMETERS = 256;
const MAX_SCHEMA_DEPTH = 24;
const MAX_OBJECT_FIELDS = 256;
const MAX_ENUM_VALUES = 1_024;

interface GeneratedCatalogResult {
  commands: JavaCommandDescriptor[];
  relativePath: string;
  schemaVersion: "1.0";
  catalogId: string;
  supportVersion: string;
  catalogHash: string;
}

export interface GeneratedJavaCatalog {
  schemaVersion: "1.0";
  catalogId: string;
  supportVersion: string;
  catalogHash: string;
  commands: JavaCommandDescriptor[];
}

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

export function generatedCatalogHash(commands: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(commands), "utf8").digest("hex")}`;
}

export function parseGeneratedJavaCatalog(raw: unknown): GeneratedJavaCatalog {
  const value = record(raw);
  if (!value || value.schemaVersion !== "1.0" || !Array.isArray(value.commands) || value.commands.length > MAX_COMMANDS) {
    throw new Error("Generated Java catalog must use schema version 1.0 and contain a bounded commands array");
  }
  const supportVersion = text(value.supportVersion, "support version", 64);
  const catalogId = text(value.catalogId, "catalog ID", 256);
  const catalogHash = text(value.catalogHash, "catalog hash", 96);
  if (!/^sha256:[0-9a-f]{64}$/.test(catalogHash)) throw new Error("Generated Java catalog hash is invalid");
  const expectedHash = generatedCatalogHash(value.commands);
  if (catalogHash !== expectedHash) throw new Error("Generated Java catalog hash does not match its commands");
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
