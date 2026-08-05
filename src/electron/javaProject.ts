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
  }
  return signatures.filter((signature) => signature.text.includes("(") && !stripAnnotations(signature.text).includes("="));
}

function parseCallable(signature: string, ownerName: string): { constructorParameters?: RawParameter[]; method?: Omit<ParsedMethod, "line"> } | null {
  const annotated = /@(?:[$\w.]*\.)?BordeauxCommand\b/.test(signature);
  let clean = stripAnnotations(signature).replace(/\s+/g, " ").trim();
  const visibility = clean.match(/\b(public|protected|private)\b/)?.[1];
  if (visibility !== "public" && !annotated) return null;
  clean = clean.replace(/^(?:(?:public|protected|private|static|final|synchronized|native|abstract|default|strictfp)\s+)+/, "");
  const openIndex = clean.indexOf("(");
  if (openIndex < 1) return null;
  const closeIndex = findMatching(clean, openIndex, "(", ")");
  if (closeIndex < 0) return null;
  const prefix = clean.slice(0, openIndex).trim();
  const parameters = parseParameters(clean.slice(openIndex + 1, closeIndex));
  if (prefix === ownerName) return { constructorParameters: parameters };
  const methodMatch = prefix.match(/^(.*\S)\s+([$A-Za-z_][$\w]*)$/);
  if (!methodMatch) return null;
  const returnType = normalizeJavaType(methodMatch[1]);
  if (!returnType || /^(if|for|while|switch|catch|new)$/.test(returnType)) return null;
  return { method: { name: methodMatch[2], returnType, parameters, annotated } };
}

function declaresConstructor(signature: string, ownerName: string): boolean {
  const clean = stripAnnotations(signature)
    .replace(/^(?:(?:public|protected|private|static|final|synchronized|native|abstract|default|strictfp)\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.startsWith(`${ownerName}(`) || clean.startsWith(`${ownerName} (`);
}

function enumValues(body: string): string[] {
  const head = body.split(";")[0] ?? "";
  return splitTopLevel(head).flatMap((entry) => {
    const match = entry.trim().match(/^([$A-Za-z_][$\w]*)/);
    return match ? [match[1]] : [];
  });
}

function parseTypes(unit: JavaSourceUnit): ParsedJavaType[] {
  const types: ParsedJavaType[] = [];
  const pattern = /\b((?:public\s+|protected\s+|private\s+|static\s+|final\s+|abstract\s+|sealed\s+|non-sealed\s+)*)((class|record|enum))\s+([$A-Za-z_][$\w]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(unit.sanitized))) {
    const openIndex = unit.sanitized.indexOf("{", pattern.lastIndex);
    if (openIndex < 0) continue;
    const closeIndex = findMatching(unit.sanitized, openIndex, "{", "}");
    if (closeIndex < 0) continue;
    const kind = match[3] as ParsedJavaType["kind"];
    const name = match[4];
    const header = unit.sanitized.slice(pattern.lastIndex, openIndex).trim();
    const body = unit.sanitized.slice(openIndex + 1, closeIndex);
    const bodyOffset = openIndex + 1;
    const members = topLevelMemberSignatures(body);
    const constructors: ParsedConstructor[] = [];
    const methods: ParsedMethod[] = [];
    let hasDeclaredConstructor = false;
    for (const member of members) {
      hasDeclaredConstructor ||= declaresConstructor(member.text, name);
      const callable = parseCallable(member.text, name);
      if (!callable) continue;
      const line = countLinesBefore(unit.sanitized, bodyOffset + member.offset);
      if (callable.constructorParameters) constructors.push({ parameters: callable.constructorParameters, line });
      if (callable.method) methods.push({ ...callable.method, line });
    }
    const recordOpen = kind === "record" ? header.indexOf("(") : -1;
    const recordClose = recordOpen >= 0 ? findMatching(header, recordOpen, "(", ")") : -1;
    const qualifiedName = unit.packageName ? `${unit.packageName}.${name}` : name;
    types.push({
      name,
      qualifiedName,
      packageName: unit.packageName,
      kind,
      header,
      abstract: /\babstract\b/.test(match[1] ?? ""),
      commandClass: kind === "class" && /\b(?:extends|implements)\b[^\{]*\bCommand(?:Base)?\b/.test(header),
      recordFields: recordOpen >= 0 && recordClose > recordOpen ? parseParameters(header.slice(recordOpen + 1, recordClose)) : [],
      enumValues: kind === "enum" ? enumValues(body) : [],
      hasDeclaredConstructor,
      constructors,
      methods,
      source: unit,
      line: countLinesBefore(unit.sanitized, match.index),
    });
    pattern.lastIndex = closeIndex + 1;
  }
  return types;
}

function simpleTypeName(javaType: string): string {
  const withoutArray = javaType.replace(/\[\]$/g, "");
  const genericIndex = withoutArray.indexOf("<");
  const raw = genericIndex >= 0 ? withoutArray.slice(0, genericIndex) : withoutArray;
  return raw.split(".").at(-1) ?? raw;
}

function genericParts(javaType: string): { base: string; arguments: string[] } | null {
  const openIndex = javaType.indexOf("<");
  if (openIndex < 0) return null;
  const closeIndex = findMatching(javaType, openIndex, "<", ">");
  if (closeIndex < 0) return null;
  return { base: javaType.slice(0, openIndex), arguments: splitTopLevel(javaType.slice(openIndex + 1, closeIndex)) };
}

function dependencyType(javaType: string): boolean {
  const simple = simpleTypeName(javaType);
  return /(?:Subsystem|Command|Supplier|Consumer|Runnable|Controller|Motor|Drivetrain|Drive|RobotContainer)$/.test(simple);
}

function humanize(value: string): string {
  const spaced = value
    .replace(/Command$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$]+/g, " ")
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : value;
}

function resolveKnownType(javaType: string, packageName: string, types: ParsedJavaType[]): ParsedJavaType | undefined {
  const normalized = normalizeJavaType(javaType).replace(/^\?extends/, "").replace(/^\?super/, "");
  const raw = normalized.split("<")[0].replace(/\[\]$/g, "");
  if (raw.includes(".")) return types.find((type) => type.qualifiedName === raw);
  return types.find((type) => type.packageName === packageName && type.name === raw)
    ?? types.find((type) => type.name === raw && types.filter((candidate) => candidate.name === raw).length === 1);
}

function schemaFor(javaType: string, packageName: string, types: ParsedJavaType[], resolving = new Set<string>(), depth = 0): JavaValueSchema {
  const normalized = normalizeJavaType(javaType).replace(/^\?extends/, "").replace(/^\?super/, "");
  if (depth > MAX_SCHEMA_DEPTH) return { kind: "opaque", javaType: normalized };
  const simple = simpleTypeName(normalized);
  if (["boolean", "Boolean"].includes(simple)) return { kind: "boolean", javaType: normalized };
  if (["byte", "short", "int", "Byte", "Short", "Integer"].includes(simple)) return { kind: "integer", javaType: normalized };
  if (["long", "Long", "BigInteger"].includes(simple)) return { kind: "integerString", javaType: normalized };
  if (["float", "double", "Float", "Double"].includes(simple)) return { kind: "number", javaType: normalized };
  if (simple === "BigDecimal") return { kind: "decimalString", javaType: normalized };
  if (["char", "Character", "String", "UUID"].includes(simple)) return { kind: "string", javaType: normalized };
  if (normalized.endsWith("[]")) return { kind: "array", javaType: normalized, element: schemaFor(normalized.slice(0, -2), packageName, types, resolving, depth + 1) };

  const generic = genericParts(normalized);
  if (generic) {
    const base = simpleTypeName(generic.base);
    if (["List", "Set", "Collection", "Iterable", "ArrayList", "LinkedList"].includes(base)) {
      return { kind: "array", javaType: normalized, element: schemaFor(generic.arguments[0] ?? "Object", packageName, types, resolving, depth + 1) };
    }
    if (base === "Optional") {
      return { kind: "optional", javaType: normalized, element: schemaFor(generic.arguments[0] ?? "Object", packageName, types, resolving, depth + 1) };
    }
    if (base === "Map" && ["String", "java.lang.String"].includes(generic.arguments[0] ?? "")) {
      return { kind: "map", javaType: normalized, value: schemaFor(generic.arguments[1] ?? "Object", packageName, types, resolving, depth + 1) };
    }
  }

  const known = resolveKnownType(normalized, packageName, types);
  if (!known) return { kind: "opaque", javaType: normalized };
  if (known.kind === "enum") return { kind: "enum", javaType: known.qualifiedName, enumValues: known.enumValues };
  if (resolving.has(known.qualifiedName)) return { kind: "opaque", javaType: known.qualifiedName };
  const nextResolving = new Set(resolving).add(known.qualifiedName);
  const shape = known.kind === "record"
    ? known.recordFields
    : [...known.constructors].sort((a, b) => a.parameters.length - b.parameters.length)[0]?.parameters ?? [];
  if (shape.length === 0 || shape.length > MAX_OBJECT_FIELD_COUNT) return { kind: "opaque", javaType: known.qualifiedName };
  const fields: JavaValueField[] = shape.map((field) => ({
    name: field.name,
    schema: schemaFor(field.javaType, known.packageName, types, nextResolving, depth + 1),
  }));
  return { kind: "object", javaType: known.qualifiedName, fields };
}

function commandParameters(parameters: RawParameter[], packageName: string, types: ParsedJavaType[]): JavaCommandParameter[] {
  return parameters.map((parameter) => ({
    name: parameter.name,
    javaType: parameter.javaType,
    role: dependencyType(parameter.javaType) ? "dependency" : "argument",
    schema: schemaFor(parameter.javaType, packageName, types),
  }));
}

function commandReturnType(returnType: string, packageName: string, types: ParsedJavaType[]): "confirmed" | "inferred" | null {
  const simple = simpleTypeName(returnType);
