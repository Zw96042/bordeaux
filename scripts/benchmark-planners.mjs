import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { buildPlannerBenchmarkReport } = require("../dist-electron/electron/benchmark/plannerReport.js");
const {
  captureChoreoRun, CHOREO_BINARY_SHA256, CHOREO_SLEIPNIR_VERSION, CHOREO_VERSION, choreoInvocation, prepareChoreoFixture,
} = require("../dist-electron/electron/benchmark/choreoAdapter.js");
const { CorridorCorpus } = require("../dist-electron/electron/benchmark/corridor.js");
const { FixedGeometryCorpus } = require("../dist-electron/electron/benchmark/fixedGeometry.js");
const {
  capturePathPlannerRun, PATHPLANNER_VERSION, PATHPLANNER_WPILIB_VERSION, pathPlannerInvocation, preparePathPlannerFixture,
} = require("../dist-electron/electron/benchmark/pathPlannerAdapter.js");
const { getPlanner } = require("../dist-electron/shared/planners/index.js");
const { decodeProjectFile } = require("../dist-electron/shared/project/fileFormat.js");
const execFileAsync = promisify(execFile);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(name, fallback, minimum = 0) {
  const value = Number.parseInt(option(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`--${name} must be an integer of at least ${minimum}.`);
  return value;
}

const repositoryRoot = process.cwd();
const corpusDirectory = path.join(repositoryRoot, "benchmarks", "planner-corpus", "v1");
const repetitions = positiveInteger("repetitions", 3, 2);
const warmups = positiveInteger("warmups", 0);
const latencyGateMs = positiveInteger("latency-gate-ms", 30_000, 1);
const outputPath = path.resolve(repositoryRoot, option("output", ".benchmark-results/planners.json"));
const choreoBinaryOption = process.env.BORDEAUX_CHOREO_CLI;
if (!choreoBinaryOption) throw new Error("Set BORDEAUX_CHOREO_CLI to the pinned Choreo v2026.0.3 Linux x86_64 standalone choreo-cli.");
const choreoBinary = path.resolve(choreoBinaryOption);
const javaBinary = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, "bin", "java")
  : (await execFileAsync("which", ["java"])).stdout.trim();
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-planner-benchmark-"));

function digest(contents) {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function filesBelow(directory, ignoredDirectories = new Set()) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((first, second) => first.name < second.name ? -1 : first.name > second.name ? 1 : 0)) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(absolute, ignoredDirectories));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function artifactManifest(paths) {
  const files = [];
  for (const entry of paths) {
    const stat = await fs.stat(entry.path);
    const absoluteFiles = stat.isDirectory()
      ? await filesBelow(entry.path, new Set(entry.ignoreDirectories ?? []))
      : [entry.path];
    for (const absolute of absoluteFiles) {
      const contents = await fs.readFile(absolute);
      files.push({
        path: path.relative(repositoryRoot, absolute) || path.basename(absolute),
        sha256: digest(contents),
        bytes: contents.length,
      });
    }
  }
  files.sort((first, second) => first.path < second.path ? -1 : first.path > second.path ? 1 : 0);
  return { sha256: digest(`${JSON.stringify(files)}\n`), files };
}

function normalizedDigest(trajectory, events = []) {
  return digest(`${JSON.stringify({ trajectory, events })}\n`);
}

function eventsFor(corridorCase, totalTimeS) {
  return corridorCase.eventOrder.map((id, index) => ({
    id,
    timeS: totalTimeS * (index + 1) / (corridorCase.eventOrder.length + 1),
  }));
}

async function execute(invocation, timeout = 60_000) {
  const started = performance.now();
  try {
    const result = await execFileAsync(invocation.executable, invocation.arguments, {
      cwd: invocation.workingDirectory,
      env: process.env,
      timeout,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, latencyMs: performance.now() - started };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : String(error),
      latencyMs: performance.now() - started,
    };
  }
}

const projectContents = await fs.readFile(path.join(corpusDirectory, "corpus.bordeaux.json"), "utf8");
const project = decodeProjectFile(projectContents).project;
const fixedCorpus = FixedGeometryCorpus.loadV1(corpusDirectory);
const corridorCorpus = CorridorCorpus.loadV1(corpusDirectory);
const fixtures = [
  ...fixedCorpus.cases.map((fixture) => ({ benchmarkClass: "fixed-geometry", ...fixture })),
  ...corridorCorpus.cases.map((fixture) => ({ benchmarkClass: "corridor", ...fixture })),
];

const choreoBytes = await fs.readFile(choreoBinary);
if (digest(choreoBytes) !== CHOREO_BINARY_SHA256) throw new Error("Choreo CLI does not match the pinned binary digest.");
const choreoVersion = await execFileAsync(choreoBinary, ["--version"]);
if (choreoVersion.stdout.trim() !== `choreo-cli ${CHOREO_VERSION}`) throw new Error("Choreo CLI does not report the pinned version.");
const javaVersion = await execFileAsync(javaBinary, ["-version"]);
const gitCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
const gitStatus = (await execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot })).stdout;
const packageDocument = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const inputFiles = [
  "manifest.json", "corpus.bordeaux.json", "fixed-geometry.json", "fixed-geometry.sha256", "corridor.json", "corridor.sha256",
];
const inputs = Object.fromEntries(await Promise.all(inputFiles.map(async (file) => [file, digest(await fs.readFile(path.join(corpusDirectory, file)))])));
const executedArtifacts = await artifactManifest([
  { path: path.join(repositoryRoot, "dist-electron") },
  { path: path.join(repositoryRoot, "scripts", "benchmark-planners.mjs") },
  { path: path.join(repositoryRoot, "benchmarks", "adapters", "pathplanner"), ignoreDirectories: [".gradle", "build"] },
  { path: path.join(repositoryRoot, "java", "gradlew") },
  { path: path.join(repositoryRoot, "java", "gradle", "wrapper", "gradle-wrapper.jar") },
  { path: path.join(repositoryRoot, "java", "gradle", "wrapper", "gradle-wrapper.properties") },
  { path: await fs.realpath(javaBinary) },
]);
const runs = [];
const warmupFailures = [];

function validatorFor(benchmarkClass) {
  return benchmarkClass === "fixed-geometry" ? fixedCorpus : corridorCorpus;
}

async function bordeauxRun(fixture, iteration) {
  const pathDocument = project.paths.find((candidate) => candidate.id === fixture.pathId);
  const started = performance.now();
  try {
    const candidate = getPlanner("profiledSpline").generate({ path: pathDocument, robot: project.robot });
    const latencyMs = performance.now() - started;
    const submitted = fixture.benchmarkClass === "corridor"
      ? { ...candidate, events: eventsFor(fixture, candidate.totalTimeS) }
      : candidate;
    const validation = validatorFor(fixture.benchmarkClass).validate(fixture.id, submitted);
    const normalized = validation.normalized ?? null;
    return {
      planner: "Bordeaux", toolVersion: packageDocument.version, benchmarkClass: fixture.benchmarkClass,
      fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
      outcome: "generated", latencyMs, inputSha256: inputs["corpus.bordeaux.json"],
      normalizedSha256: normalized ? normalizedDigest(normalized, submitted.events ?? []) : null,
      trajectoryTimeS: normalized?.totalTimeS ?? null,
      validation: { valid: validation.valid, rankingEligible: validation.rankingEligible, issues: validation.issues },
      raw: {
        input: null,
        output: `${JSON.stringify(submitted)}\n`, stdout: "", stderr: "",
        invocation: { executable: "in-process", arguments: ["profiledSpline", fixture.pathId], workingDirectory: repositoryRoot },
      },
    };
  } catch (error) {
    return {
      planner: "Bordeaux", toolVersion: packageDocument.version, benchmarkClass: fixture.benchmarkClass,
      fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
      outcome: "failed", latencyMs: performance.now() - started, inputSha256: inputs["corpus.bordeaux.json"],
      normalizedSha256: null, trajectoryTimeS: null, validation: null, raw: null,
      failure: error instanceof Error ? error.message : "Bordeaux planning failed.",
    };
  }
}

async function pathPlannerRun(fixture, iteration, runDirectory) {
  const prepared = preparePathPlannerFixture(corpusDirectory, fixture.benchmarkClass, fixture.id);
  if (!prepared.supported) return {
    planner: "PathPlanner", toolVersion: PATHPLANNER_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration: 0,
    outcome: "unsupported", latencyMs: null, inputSha256: inputs["corpus.bordeaux.json"],
    normalizedSha256: null, trajectoryTimeS: null, validation: null, raw: null,
    unsupported: { code: prepared.code, reason: prepared.reason },
  };
  const requestPath = path.join(runDirectory, "pathplanner-request.json");
  const rawOutputPath = path.join(runDirectory, "pathplanner-output.json");
  await fs.writeFile(requestPath, prepared.requestContents);
  await fs.rm(rawOutputPath, { force: true });
  const invocation = pathPlannerInvocation(repositoryRoot, requestPath, rawOutputPath);
  const processCapture = await execute(invocation);
  const rawOutput = await fs.readFile(rawOutputPath, "utf8").catch(() => null);
  const captured = capturePathPlannerRun(prepared, { invocation, ...processCapture, rawOutput });
  if (captured.outcome !== "generated" || !captured.normalized) return {
    planner: "PathPlanner", toolVersion: PATHPLANNER_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
    outcome: "failed", latencyMs: processCapture.latencyMs, inputSha256: prepared.requestSha256,
    normalizedSha256: null, trajectoryTimeS: null, validation: null,
    raw: { input: prepared.requestContents, output: rawOutput ?? "", stdout: captured.process.stdout, stderr: captured.process.stderr, invocation },
    failure: captured.failure,
  };
  const validation = validatorFor(fixture.benchmarkClass).validate(fixture.id, { ...captured.normalized, events: captured.events });
  return {
    planner: "PathPlanner", toolVersion: PATHPLANNER_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
    outcome: "generated", latencyMs: processCapture.latencyMs, inputSha256: prepared.requestSha256,
    normalizedSha256: normalizedDigest(captured.normalized, captured.events), trajectoryTimeS: captured.normalized.totalTimeS,
    validation: { valid: validation.valid, rankingEligible: validation.rankingEligible, issues: validation.issues },
    raw: { input: prepared.requestContents, output: captured.rawOutput ?? "", stdout: captured.process.stdout, stderr: captured.process.stderr, invocation },
  };
}

async function choreoRun(fixture, iteration, runDirectory) {
  const prepared = prepareChoreoFixture(corpusDirectory, fixture.benchmarkClass, fixture.id);
  if (!prepared.supported) return {
    planner: "Choreo", toolVersion: CHOREO_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration: 0,
    outcome: "unsupported", latencyMs: null, inputSha256: inputs["corpus.bordeaux.json"],
    normalizedSha256: null, trajectoryTimeS: null, validation: null, raw: null,
    unsupported: { code: prepared.code, reason: prepared.reason },
  };
  const projectPath = path.join(runDirectory, "choreo-project.chor");
  const trajectoryPath = path.join(runDirectory, `${prepared.trajectoryName}.traj`);
  await fs.writeFile(projectPath, prepared.projectContents);
  await fs.writeFile(trajectoryPath, prepared.trajectoryContents);
  const invocation = choreoInvocation(choreoBinary, projectPath, prepared.trajectoryName);
  const processCapture = await execute(invocation, 180_000);
  const rawOutput = await fs.readFile(trajectoryPath, "utf8").catch(() => null);
  const captured = captureChoreoRun(prepared, { invocation, ...processCapture, rawOutput });
  if (captured.outcome !== "generated" || !captured.normalized) return {
    planner: "Choreo", toolVersion: CHOREO_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
    outcome: "failed", latencyMs: processCapture.latencyMs, inputSha256: prepared.inputSha256,
    normalizedSha256: null, trajectoryTimeS: null, validation: null,
    raw: {
      input: `${prepared.projectContents}${prepared.trajectoryContents}`,
      output: rawOutput ?? "", stdout: captured.process.stdout, stderr: captured.process.stderr, invocation,
    },
    failure: captured.failure,
  };
  const validation = validatorFor(fixture.benchmarkClass).validate(fixture.id, { ...captured.normalized, events: captured.events });
  return {
    planner: "Choreo", toolVersion: CHOREO_VERSION, benchmarkClass: fixture.benchmarkClass,
    fixtureId: fixture.id, deterministicSeed: fixture.deterministicSeed, iteration,
    outcome: "generated", latencyMs: processCapture.latencyMs, inputSha256: prepared.inputSha256,
    normalizedSha256: normalizedDigest(captured.normalized, captured.events), trajectoryTimeS: captured.normalized.totalTimeS,
    validation: { valid: validation.valid, rankingEligible: validation.rankingEligible, issues: validation.issues },
    raw: {
      input: `${prepared.projectContents}${prepared.trajectoryContents}`,
      output: captured.rawOutput ?? "", stdout: captured.process.stdout, stderr: captured.process.stderr, invocation,
    },
  };
}

try {
  for (const fixture of fixtures) {
    const runDirectory = path.join(temporaryDirectory, fixture.benchmarkClass, fixture.id);
    await fs.mkdir(runDirectory, { recursive: true });
    const planners = [bordeauxRun, pathPlannerRun, choreoRun];
    for (const planner of planners) {
      for (let warmup = 0; warmup < warmups; warmup += 1) {
        const result = await planner(fixture, -(warmup + 1), runDirectory);
        if (result.outcome === "failed" || (result.outcome === "generated" && !result.validation?.valid)) {
          warmupFailures.push({ planner: result.planner, fixtureId: fixture.id, outcome: result.outcome, failure: result.failure ?? null });
        }
        if (result.outcome === "unsupported") break;
      }
      const unsupported = await planner(fixture, 1, runDirectory);
      runs.push(unsupported);
      if (unsupported.outcome === "unsupported") continue;
      for (let iteration = 2; iteration <= repetitions; iteration += 1) {
        runs.push(await planner(fixture, iteration, runDirectory));
      }
    }
  }

  const cpu = os.cpus()[0];
  const manifest = {
    generatedAt: new Date().toISOString(),
    protocol: {
      repetitions, warmups, latencyGateMs,
      order: "fixed corpus order; Bordeaux, PathPlanner, then Choreo; sequential execution",
      latency: "monotonic wall time around planner invocation only; file preparation and neutral validation excluded",
      determinism: "every supported fixture repeats from identical canonical input; normalized output digests must match",
      percentile: "nearest-rank p50 and p95 over measured supported attempts",
      warmupFailures,
    },
    inputs,
    hardware: {
      platform: os.platform(), release: os.release(), arch: os.arch(),
      cpu: cpu ? { model: cpu.model, logicalCores: os.cpus().length } : null,
      totalMemoryBytes: os.totalmem(),
      node: process.version, v8: process.versions.v8, uv: process.versions.uv,
      java: (javaVersion.stderr || javaVersion.stdout).trim(),
      git: { commit: gitCommit, dirty: Boolean(gitStatus.trim()) },
    },
    executedArtifacts,
    tools: {
      Bordeaux: { version: packageDocument.version, planner: "profiledSpline" },
      PathPlanner: { version: PATHPLANNER_VERSION, wpilibVersion: PATHPLANNER_WPILIB_VERSION, java: "17" },
      Choreo: { version: CHOREO_VERSION, sleipnirVersion: CHOREO_SLEIPNIR_VERSION, binarySha256: CHOREO_BINARY_SHA256,
        runtime: "ELF x86-64, GNU/Linux 3.2+ standalone" },
    },
  };
  const report = buildPlannerBenchmarkReport(manifest, runs);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryOutput = `${outputPath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
  await fs.rename(temporaryOutput, outputPath);
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    runs: runs.length,
    comparisons: report.comparisons.length,
    gates: report.gates,
    competitiveClaimsAllowed: report.competitiveClaimsAllowed,
  })}\n`);
  if (!report.gates.passed || warmupFailures.length > 0) process.exitCode = 1;
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
