import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { JavaCommandCatalog, JavaIntegrationStatus } from "../shared/types";
import { writeBufferAtomically, writeJsonAtomically } from "./projectFiles";

export const JAVA_SUPPORT_VERSION = "0.1.0";
const MAX_BUILD_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_OUTPUT_BYTES = 1024 * 1024;
const BUILD_TIMEOUT_MS = 150_000;
const MANAGED_BEGIN = "// BEGIN Bordeaux Java command support";
const MANAGED_END = "// END Bordeaux Java command support";

interface InstallPreview {
  projectRoot: string;
  buildFile: string;
  buildFileName: "build.gradle" | "build.gradle.kts";
  buildHash: string;
  nextBuildContents: string;
  runtimeJar: Uint8Array;
  processorJar: Uint8Array;
  runtimeHash: string;
  processorHash: string;
  replacingManagedBlock: boolean;
}

let activeBuild: { child: ChildProcessWithoutNullStreams; canceled: boolean; killGraceMs: number } | null = null;
const killEscalations = new WeakMap<ChildProcessWithoutNullStreams, NodeJS.Timeout>();

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function regularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function boundedFileHash(filePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARTIFACT_BYTES) return undefined;
    return sha256(await fs.readFile(filePath));
  } catch {
    return undefined;
  }
}

async function buildFileFor(projectRoot: string): Promise<{ path: string; name: "build.gradle" | "build.gradle.kts" }> {
  const groovy = path.join(projectRoot, "build.gradle");
  const kotlin = path.join(projectRoot, "build.gradle.kts");
  const [hasGroovy, hasKotlin] = await Promise.all([regularFile(groovy), regularFile(kotlin)]);
  if (hasGroovy === hasKotlin) throw new Error("Java support requires exactly one regular build.gradle or build.gradle.kts file in the linked project root");
  return hasGroovy ? { path: groovy, name: "build.gradle" } : { path: kotlin, name: "build.gradle.kts" };
}

function managedBlock(buildFileName: "build.gradle" | "build.gradle.kts"): string {
  const applyLine = buildFileName === "build.gradle"
    ? "apply from: file('.bordeaux/bordeaux.gradle')"
    : "apply(from = file(\".bordeaux/bordeaux.gradle\"))";
  return `${MANAGED_BEGIN}\n${applyLine}\n${MANAGED_END}`;
}

function withManagedBlock(contents: string, block: string): { contents: string; replacing: boolean } {
  const begin = contents.indexOf(MANAGED_BEGIN);
  const end = contents.indexOf(MANAGED_END);
  if ((begin < 0) !== (end < 0) || (begin >= 0 && end < begin)) throw new Error("The existing Bordeaux Java support block is incomplete; restore or remove it before reinstalling");
  if (begin >= 0) {
    const after = end + MANAGED_END.length;
    return { contents: `${contents.slice(0, begin)}${block}${contents.slice(after)}`, replacing: true };
  }
  return { contents: `${contents.replace(/\s*$/, "")}\n\n${block}\n`, replacing: false };
}

function gradleSupportScript(): string {
  return `// Managed by Bordeaux. Reinstall support through the app instead of editing this file.\n` +
`def bordeauxRuntimeJar = rootProject.file('.bordeaux/lib/bordeaux-runtime.jar')\n` +
`def bordeauxProcessorJar = rootProject.file('.bordeaux/lib/bordeaux-processor.jar')\n` +
`dependencies {\n` +
`  implementation files(bordeauxRuntimeJar)\n` +
`  implementation 'com.fasterxml.jackson.core:jackson-databind:2.18.3'\n` +
`  annotationProcessor files(bordeauxRuntimeJar, bordeauxProcessorJar)\n` +
`}\n` +
`tasks.withType(org.gradle.api.tasks.compile.JavaCompile).configureEach {\n` +
