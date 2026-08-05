import fs from "node:fs/promises";
import path from "node:path";
import type {
  JavaCommandCatalog,
  JavaCommandDescriptor,
  JavaCommandParameter,
  JavaValueField,
  JavaValueSchema,
} from "../shared/types";
import { readGeneratedJavaCatalog } from "./javaGeneratedCatalog";

const MAX_DIRECTORY_COUNT = 2_000;
const MAX_SOURCE_FILE_COUNT = 2_000;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_SCAN_DEPTH = 8;
const MAX_DISCOVERED_TYPE_COUNT = 10_000;
const MAX_DISCOVERED_COMMAND_COUNT = 5_000;
const MAX_SCHEMA_DEPTH = 24;
const MAX_OBJECT_FIELD_COUNT = 256;
const MAX_SETTINGS_FILE_BYTES = 64 * 1024;
const MAX_DIRECTORY_ENTRY_COUNT = 20_000;
const SKIPPED_DIRECTORIES = new Set([".git", ".gradle", ".idea", ".vscode", "build", "out", "target", "node_modules"]);

export function readableJavaProjectError(error: unknown, projectName = "Java project"): Error {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (["ENOENT", "ENOTDIR"].includes(String(code))) {
    return new Error(`“${projectName}” is no longer available at its saved location. Choose Link… to locate it again.`);
  }
  if (["EACCES", "EPERM"].includes(String(code))) {
    return new Error(`Bordeaux does not have permission to read “${projectName}”. Check the folder permissions or choose Link… again.`);
  }
  if (code) return new Error(`Bordeaux could not read “${projectName}” (${code}). Check the folder and try again.`);
  return error instanceof Error ? error : new Error(String(error));
}

interface JavaSourceUnit {
  absolutePath: string;
  relativePath: string;
  text: string;
  sanitized: string;
  packageName: string;
}

interface RawParameter {
  name: string;
  javaType: string;
}

interface ParsedConstructor {
  parameters: RawParameter[];
  line: number;
}

interface ParsedMethod {
  name: string;
  returnType: string;
  parameters: RawParameter[];
  line: number;
  annotated: boolean;
}

interface ParsedJavaType {
  name: string;
  qualifiedName: string;
  packageName: string;
  kind: "class" | "record" | "enum";
  header: string;
  abstract: boolean;
  commandClass: boolean;
  recordFields: RawParameter[];
  enumValues: string[];
  hasDeclaredConstructor: boolean;
  constructors: ParsedConstructor[];
  methods: ParsedMethod[];
  source: JavaSourceUnit;
  line: number;
}

interface MemberSignature {
  text: string;
  offset: number;
}

function countLinesBefore(value: string, offset: number): number {
  let lines = 1;
  for (let index = 0; index < offset; index += 1) if (value.charCodeAt(index) === 10) lines += 1;
  return lines;
}

function sanitizeJava(source: string): string {
  const output = source.split("");
  let index = 0;
  let state: "code" | "line" | "block" | "string" | "character" | "text" = "code";
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];
    const third = source[index + 2];
    if (state === "code") {
      if (current === "/" && next === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "line";
        continue;
      }
      if (current === "/" && next === "*") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "block";
        continue;
      }
      if (current === '"' && next === '"' && third === '"') {
        output[index] = output[index + 1] = output[index + 2] = " ";
        index += 3;
        state = "text";
        continue;
      }
      if (current === '"') {
        output[index] = " ";
        index += 1;
        state = "string";
        continue;
      }
      if (current === "'") {
        output[index] = " ";
        index += 1;
        state = "character";
        continue;
      }
      index += 1;
      continue;
    }
    if (state === "line") {
      if (current === "\n") state = "code";
      else output[index] = " ";
      index += 1;
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") {
        output[index] = output[index + 1] = " ";
        index += 2;
        state = "code";
      } else {
        if (current !== "\n") output[index] = " ";
        index += 1;
      }
      continue;
    }
    if (state === "text") {
      if (current === '"' && next === '"' && third === '"') {
        output[index] = output[index + 1] = output[index + 2] = " ";
        index += 3;
        state = "code";
      } else {
        if (current !== "\n") output[index] = " ";
        index += 1;
      }
      continue;
    }
    if (current === "\\") {
      output[index] = " ";
      if (index + 1 < output.length && source[index + 1] !== "\n") output[index + 1] = " ";
      index += 2;
      continue;
    }
    const closes = (state === "string" && current === '"') || (state === "character" && current === "'");
    if (current !== "\n") output[index] = " ";
    index += 1;
    if (closes) state = "code";
  }
  return output.join("");
}

function findMatching(value: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === open) depth += 1;
    else if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(value: string, delimiter = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let angle = 0;
  let paren = 0;
  let bracket = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "<") angle += 1;
    else if (char === ">") angle = Math.max(0, angle - 1);
    else if (char === "(") paren += 1;
    else if (char === ")") paren = Math.max(0, paren - 1);
    else if (char === "[") bracket += 1;
    else if (char === "]") bracket = Math.max(0, bracket - 1);
    else if (char === delimiter && angle === 0 && paren === 0 && bracket === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function stripAnnotations(value: string): string {
  let result = value;
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(/@[$\w.]+(?:\s*\([^()]*(?:\([^()]*\)[^()]*)*\))?\s*/g, "");
  }
  return result;
}

function normalizeJavaType(value: string): string {
  return stripAnnotations(value)
    .replace(/\bfinal\s+/g, "")
    .replace(/\s*\.\.\.\s*/g, "[]")
    .replace(/\s+/g, " ")
    .replace(/\s*([<>,?\[\]])\s*/g, "$1")
    .trim();
}

function normalizeBindingJavaType(value: string): string {
  return normalizeJavaType(value).replace(/\b(?:[$A-Za-z_][$\w]*\.)+([$A-Za-z_][$\w]*)/g, "$1");
}

function parseParameters(value: string): RawParameter[] {
  return splitTopLevel(value).flatMap((raw, index) => {
    const clean = stripAnnotations(raw)
      .replace(/\bfinal\s+/g, "")
      .replace(/\s*\.\.\.\s*/g, "[] ")
      .replace(/\s+/g, " ")
      .trim();
    const match = clean.match(/^(.*\S)\s+([$A-Za-z_][$\w]*)$/);
    if (!match) return [];
    const javaType = normalizeJavaType(match[1]);
    return javaType ? [{ name: match[2] || `arg${index + 1}`, javaType }] : [];
  });
}

function topLevelMemberSignatures(body: string): MemberSignature[] {
  const signatures: MemberSignature[] = [];
  let segmentStart = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{") {
      if (depth === 0) {
        const text = body.slice(segmentStart, index).trim();
        if (text) signatures.push({ text, offset: segmentStart + body.slice(segmentStart, index).search(/\S|$/) });
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) segmentStart = index + 1;
      continue;
    }
    if (char === ";" && depth === 0) {
      const text = body.slice(segmentStart, index).trim();
      if (text) signatures.push({ text, offset: segmentStart + body.slice(segmentStart, index).search(/\S|$/) });
      segmentStart = index + 1;
    }
