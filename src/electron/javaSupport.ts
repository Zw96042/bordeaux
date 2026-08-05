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
`  options.compilerArgs.add('-Abordeaux.catalogId=' + rootProject.name)\n` +
`}\n` +
`tasks.register('bordeauxCatalog') {\n` +
`  dependsOn tasks.named('classes')\n` +
`  def catalogInput = layout.buildDirectory.file('classes/java/main/META-INF/bordeaux/commands.json')\n` +
`  def catalogOutput = layout.buildDirectory.file('bordeaux/catalog-v1.json')\n` +
`  inputs.file(catalogInput)\n` +
`  outputs.file(catalogOutput)\n` +
`  doLast {\n` +
`    def inputFile = catalogInput.get().asFile\n` +
`    if (!inputFile.isFile()) throw new GradleException('No Bordeaux command catalog was generated. Annotate at least one provider method with @BordeauxCommand.')\n` +
`    def outputFile = catalogOutput.get().asFile\n` +
`    outputFile.parentFile.mkdirs()\n` +
`    outputFile.bytes = inputFile.bytes\n` +
`  }\n` +
`}\n`;
}

function integrationGuide(): string {
  return `# Bordeaux Java integration\n\n` +
`Bordeaux owns the JSON contract and generated bindings, but your robot project keeps ownership of subsystems and autonomous lifecycle.\n\n` +
`1. Put \`@BordeauxCommand\` on public command factory methods. Add \`@BordeauxParam\` metadata to authored parameters.\n` +
`2. In Bordeaux, run **Java > Build Command Catalog** and place generated commands on event markers.\n` +
`3. Call \`dev.bordeaux.runtime.BordeauxBindings.generated(...)\` with instances of each non-static provider.\n` +
`4. Open the exported JSON below WPILib's deploy directory and call \`BordeauxTrajectoryReader.read(input, pathId)\`.\n` +
`5. Create \`BordeauxEventRunner\`, call \`periodic(elapsedSeconds)\` beside the path follower, and call \`endPath()\` when the path ends.\n\n` +
`A minimal team-owned integration looks like this (replace \`actions\`, file name, and path ID with your code):\n\n` +
"```java\n" +
`import dev.bordeaux.runtime.BordeauxBindings;\n` +
`import dev.bordeaux.runtime.*;\n` +
`import edu.wpi.first.wpilibj.Filesystem;\n` +
`import java.nio.file.Files;\n\n` +
`private final BordeauxCommandRegistry bordeauxRegistry =\n` +
`    BordeauxBindings.generated(actions);\n` +
`private BordeauxEventRunner bordeauxEvents;\n\n` +
`void startBordeauxPath(String fileName, String pathId) throws Exception {\n` +
`  var file = Filesystem.getDeployDirectory().toPath().resolve("bordeaux").resolve(fileName);\n` +
`  try (var input = Files.newInputStream(file)) {\n` +
`    bordeauxEvents = new BordeauxEventRunner(BordeauxTrajectoryReader.read(input, pathId), bordeauxRegistry);\n` +
`  }\n` +
`}\n\n` +
`void autonomousPeriodic(double elapsedSeconds) {\n` +
`  if (bordeauxEvents != null) bordeauxEvents.periodic(elapsedSeconds);\n` +
`}\n\n` +
`void endBordeauxPath() {\n` +
`  if (bordeauxEvents != null) bordeauxEvents.endPath();\n` +
`  bordeauxEvents = null;\n` +
`}\n` +
"```\n\n" +
`Pass every non-static command provider to \`BordeauxBindings.generated(...)\`; provider order does not matter. Bordeaux intentionally does not edit \`RobotContainer\` or deploy robot code.\n`;
}

async function assertSafeSupportDirectory(projectRoot: string): Promise<void> {
  let current = projectRoot;
  for (const component of [".bordeaux", "lib"]) {
    current = path.join(current, component);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Java support path ${path.relative(projectRoot, current)} must be a regular directory`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function inspectJavaSupport(projectRoot: string, catalog: JavaCommandCatalog, artifactsDirectory: string): Promise<JavaIntegrationStatus> {
  const build = await buildFileFor(projectRoot);
  const [contents, wrapperAvailable] = await Promise.all([
    fs.readFile(build.path, "utf8"),
    regularFile(path.join(projectRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew")),
  ]);
  let supportVersion: string | undefined;
  let manifestRuntimeHash: string | undefined;
  let manifestProcessorHash: string | undefined;
  let manifestScriptHash: string | undefined;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".bordeaux/install.json"), "utf8")) as Record<string, unknown>;
    if (typeof manifest.supportVersion === "string" && manifest.supportVersion.length <= 64) supportVersion = manifest.supportVersion;
    if (typeof manifest.runtimeSha256 === "string") manifestRuntimeHash = manifest.runtimeSha256;
    if (typeof manifest.processorSha256 === "string") manifestProcessorHash = manifest.processorSha256;
    if (typeof manifest.scriptSha256 === "string") manifestScriptHash = manifest.scriptSha256;
  } catch {
    supportVersion = undefined;
  }
  const [runtimeHash, processorHash, scriptHash, bundledRuntimeHash, bundledProcessorHash] = await Promise.all([
    boundedFileHash(path.join(projectRoot, ".bordeaux/lib/bordeaux-runtime.jar")),
    boundedFileHash(path.join(projectRoot, ".bordeaux/lib/bordeaux-processor.jar")),
    boundedFileHash(path.join(projectRoot, ".bordeaux/bordeaux.gradle")),
    boundedFileHash(path.join(artifactsDirectory, "bordeaux-runtime.jar")),
    boundedFileHash(path.join(artifactsDirectory, "bordeaux-processor.jar")),
