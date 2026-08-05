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

