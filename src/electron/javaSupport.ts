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
  ]);
  const installed = contents.includes(managedBlock(build.name))
    && supportVersion === JAVA_SUPPORT_VERSION
    && runtimeHash !== undefined && runtimeHash === manifestRuntimeHash && runtimeHash === bundledRuntimeHash
    && processorHash !== undefined && processorHash === manifestProcessorHash && processorHash === bundledProcessorHash
    && scriptHash !== undefined && scriptHash === manifestScriptHash && scriptHash === sha256(gradleSupportScript());
  return {
    installed,
    ...(supportVersion ? { supportVersion } : {}),
    generatedCatalog: catalog.authoritative === true,
    ...(catalog.catalogHash ? { catalogHash: catalog.catalogHash } : {}),
    buildFile: build.name,
    wrapperAvailable,
  };
}

export async function prepareJavaSupportInstall(projectRoot: string, artifactsDirectory: string): Promise<InstallPreview> {
  const canonicalRoot = await fs.realpath(projectRoot);
  const build = await buildFileFor(canonicalRoot);
  const stat = await fs.stat(build.path);
  if (stat.size > MAX_BUILD_FILE_BYTES) throw new Error(`Robot build file exceeds the ${MAX_BUILD_FILE_BYTES}-byte installation limit`);
  const buildContents = await fs.readFile(build.path, "utf8");
  if (!/edu\.wpi\.first\.GradleRIO/.test(buildContents)) throw new Error("Automatic Java support installation requires a GradleRIO Java project");
  const wrapperName = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  if (!(await regularFile(path.join(canonicalRoot, wrapperName)))) throw new Error(`Automatic Java support installation requires a regular ${wrapperName} wrapper`);
  await assertSafeSupportDirectory(canonicalRoot);
  const runtimePath = path.join(artifactsDirectory, "bordeaux-runtime.jar");
  const processorPath = path.join(artifactsDirectory, "bordeaux-processor.jar");
  let runtimeStat: Awaited<ReturnType<typeof fs.stat>>;
  let processorStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    [runtimeStat, processorStat] = await Promise.all([fs.stat(runtimePath), fs.stat(processorPath)]);
  } catch (error) {
    throw new Error("Bundled Bordeaux Java support artifacts are missing; rebuild or reinstall the desktop app", { cause: error });
  }
  if (!runtimeStat.isFile() || !processorStat.isFile() || runtimeStat.size > MAX_ARTIFACT_BYTES || processorStat.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Bundled Bordeaux Java support artifacts are missing or invalid");
  }
  const [runtimeJar, processorJar] = await Promise.all([fs.readFile(runtimePath), fs.readFile(processorPath)]);
  const next = withManagedBlock(buildContents, managedBlock(build.name));
  return {
    projectRoot: canonicalRoot,
    buildFile: build.path,
    buildFileName: build.name,
    buildHash: sha256(buildContents),
    nextBuildContents: next.contents,
    runtimeJar,
    processorJar,
    runtimeHash: sha256(runtimeJar),
    processorHash: sha256(processorJar),
    replacingManagedBlock: next.replacing,
  };
}

export async function applyJavaSupportInstall(preview: InstallPreview): Promise<void> {
  if (await fs.realpath(preview.projectRoot) !== preview.projectRoot) throw new Error("Linked Java project changed while support installation was open");
  const currentBuild = await fs.readFile(preview.buildFile, "utf8");
  if (sha256(currentBuild) !== preview.buildHash) throw new Error("Robot build file changed before installation; review and try again");
  await assertSafeSupportDirectory(preview.projectRoot);
  const supportDirectory = path.join(preview.projectRoot, ".bordeaux");
  const libraryDirectory = path.join(supportDirectory, "lib");
  await fs.mkdir(libraryDirectory, { recursive: true });
  const backupPath = path.join(supportDirectory, `${preview.buildFileName}.before-bordeaux`);
  if (!(await regularFile(backupPath))) await writeBufferAtomically(backupPath, Buffer.from(currentBuild, "utf8"));
  await writeBufferAtomically(path.join(libraryDirectory, "bordeaux-runtime.jar"), preview.runtimeJar);
  await writeBufferAtomically(path.join(libraryDirectory, "bordeaux-processor.jar"), preview.processorJar);
  await writeBufferAtomically(path.join(supportDirectory, "bordeaux.gradle"), Buffer.from(gradleSupportScript(), "utf8"));
  await writeBufferAtomically(path.join(supportDirectory, "INTEGRATION.md"), Buffer.from(integrationGuide(), "utf8"));
  await writeJsonAtomically(path.join(supportDirectory, "install.json"), {
    schemaVersion: "1.0",
    supportVersion: JAVA_SUPPORT_VERSION,
    runtimeSha256: preview.runtimeHash,
    processorSha256: preview.processorHash,
    scriptSha256: sha256(gradleSupportScript()),
  });
  await writeBufferAtomically(preview.buildFile, Buffer.from(preview.nextBuildContents, "utf8"));
}

function sanitizedBuildEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "JAVA_HOME", "GRADLE_USER_HOME", "SystemRoot", "TEMP", "TMP", "TMPDIR", "USERPROFILE"];
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
}

function stopBuild(child: ChildProcessWithoutNullStreams, killGraceMs: number): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      return;
    }
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  if (!killEscalations.has(child)) {
    const escalation = setTimeout(() => {
      if (child.exitCode !== null || child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, killGraceMs);
    killEscalations.set(child, escalation);
  }
}

function forceStopBuild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export function cancelJavaCatalogBuild(force = false): boolean {
  if (!activeBuild) return false;
  activeBuild.canceled = true;
  if (force) forceStopBuild(activeBuild.child);
  else stopBuild(activeBuild.child, activeBuild.killGraceMs);
  return true;
}

export function windowsGradleCommand(wrapper: string, args: readonly string[]): string {
  if (/[&|<>^%!]/.test(wrapper)) throw new Error("Linked project path contains characters that cannot be launched safely by cmd.exe");
  if (args.some((argument) => !/^[A-Za-z0-9_.:=/-]+$/.test(argument))) throw new Error("Gradle argument is not safe for cmd.exe");
  return `"${wrapper}" ${args.join(" ")}`;
}

export async function runJavaCatalogBuild(projectRoot: string, limits: { timeoutMs?: number; outputBytes?: number; killGraceMs?: number } = {}): Promise<{ output: string }> {
  if (activeBuild) throw new Error("A Java catalog build is already running");
  const canonicalRoot = await fs.realpath(projectRoot);
  const wrapperName = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  const wrapper = path.join(canonicalRoot, wrapperName);
  if (!(await regularFile(wrapper))) throw new Error(`Linked project does not have a regular ${wrapperName} wrapper`);
  const fixedArgs = ["bordeauxCatalog", "--no-daemon", "--console=plain"];
  const child = process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", windowsGradleCommand(wrapper, fixedArgs)], { cwd: canonicalRoot, env: sanitizedBuildEnvironment(), windowsHide: true })
    : spawn(wrapper, fixedArgs, { cwd: canonicalRoot, env: sanitizedBuildEnvironment(), detached: true });
  const killGraceMs = limits.killGraceMs ?? 2_000;
  activeBuild = { child, canceled: false, killGraceMs };
  let output = "";
  let outputBytes = 0;
  let overflow = false;
  let timedOut = false;
  const collect = (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > (limits.outputBytes ?? MAX_BUILD_OUTPUT_BYTES)) {
      overflow = true;
      stopBuild(child, killGraceMs);
      return;
    }
    output += chunk.toString("utf8");
    if (output.length > 32_768) output = output.slice(-32_768);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const timeoutMs = limits.timeoutMs ?? BUILD_TIMEOUT_MS;
  const timeout = setTimeout(() => { timedOut = true; stopBuild(child, killGraceMs); }, timeoutMs);
  let exitCode: number | null;
  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } catch (error) {
    activeBuild = null;
    throw error;
  } finally {
    clearTimeout(timeout);
    const escalation = killEscalations.get(child);
    if (escalation) clearTimeout(escalation);
    killEscalations.delete(child);
    if (activeBuild?.child === child && child.exitCode === null) stopBuild(child, killGraceMs);
  }
  const canceled = activeBuild?.canceled === true;
  activeBuild = null;
  const redacted = output
