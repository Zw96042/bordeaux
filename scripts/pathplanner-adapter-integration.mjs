import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { capturePathPlannerRun, pathPlannerInvocation, preparePathPlannerFixture } = require("../dist-electron/electron/benchmark/pathPlannerAdapter.js");
const { FixedGeometryCorpus } = require("../dist-electron/electron/benchmark/fixedGeometry.js");
const execFileAsync = promisify(execFile);

const repositoryRoot = process.cwd();
const corpusDirectory = path.join(repositoryRoot, "benchmarks", "planner-corpus", "v1");
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-pathplanner-adapter-"));

try {
  const prepared = preparePathPlannerFixture(corpusDirectory, "fixed-geometry", "fixed-blue-table-trench");
  if (!prepared.supported) throw new Error(`PathPlanner integration fixture is unsupported: ${prepared.reason}`);
  const requestPath = path.join(temporaryDirectory, "request.json");
  const rawOutputPath = path.join(temporaryDirectory, "raw-output.json");
  const invocation = pathPlannerInvocation(repositoryRoot, requestPath, rawOutputPath);
  await fs.writeFile(requestPath, prepared.requestContents);

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(invocation.executable, invocation.arguments, {
      cwd: invocation.workingDirectory,
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    exitCode = Number.isInteger(error?.code) ? error.code : 1;
    stdout = typeof error?.stdout === "string" ? error.stdout : "";
    stderr = typeof error?.stderr === "string" ? error.stderr : String(error);
  }
  let rawOutput = null;
  try {
    rawOutput = await fs.readFile(rawOutputPath, "utf8");
  } catch {
    // The capture records the missing raw-output boundary below.
  }
  const captured = capturePathPlannerRun(prepared, { invocation, exitCode, stdout, stderr, rawOutput });
  if (captured.outcome !== "generated" || !captured.normalized) {
    throw new Error(`PathPlanner adapter did not generate a normalized result: ${captured.failure ?? "unknown failure"}\n${stderr || stdout}`);
  }
  const validation = FixedGeometryCorpus.loadV1(corpusDirectory).validate(prepared.fixtureId, {
    ...captured.normalized,
    events: captured.events,
  });
  process.stdout.write(`${JSON.stringify({
    adapter: "PathPlannerLib",
    version: prepared.request.tool.version,
    wpilibVersion: prepared.request.tool.wpilibVersion,
    fixtureId: prepared.fixtureId,
    requestSha256: prepared.requestSha256,
    rawBytes: Buffer.byteLength(rawOutput ?? ""),
    samples: captured.normalized.samples.length,
    valid: validation.valid,
    rankingEligible: validation.rankingEligible,
    issues: validation.issues,
  })}\n`);
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}
