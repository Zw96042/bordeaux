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
