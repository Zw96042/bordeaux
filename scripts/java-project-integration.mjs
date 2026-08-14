import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { applyJavaSupportInstall, prepareJavaSupportInstall, runJavaCatalogBuild } = require("../dist-electron/electron/javaSupport.js");
const { discoverJavaProject } = require("../dist-electron/electron/javaProject.js");
const { buildJavaTrajectory, javaTrajectoryFileName } = require("../dist-electron/shared/export/javaTrajectory.js");
const { createDemoProject } = require("../dist-electron/shared/project/defaults.js");
const { decodeProjectFile } = require("../dist-electron/shared/project/fileFormat.js");
const execFileAsync = promisify(execFile);

const repositoryRoot = process.cwd();
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-integration-"));
try {
  const fixtureSource = path.join(repositoryRoot, "examples", "bordeaux-template-robot");
  await fs.cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(fixtureSource, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.some((part) => part === ".gradle" || part === "build" || part === ".bordeaux")
        && !parts.some((part) => /^Bordeaux-relaunch-backup-.*\.bordeaux\.json$/.test(part));
    },
  });
  if (process.platform !== "win32") await fs.chmod(path.join(fixtureRoot, "gradlew"), 0o755);

  const preview = await prepareJavaSupportInstall(fixtureRoot, path.join(repositoryRoot, "java", "dist"));
  await applyJavaSupportInstall(preview);
  await runJavaCatalogBuild(fixtureRoot);
  const catalog = await discoverJavaProject(fixtureRoot);
  const expectedIds = ["example.hold-output", "example.print-message", "example.set-output", "example.set-status"];
  const generatedIds = catalog.commands.filter((command) => command.runtimeReady).map((command) => command.id).sort();
  const generatedConditionIds = (catalog.conditions ?? []).map((condition) => condition.id).sort();
  if (!catalog.authoritative || catalog.catalogId !== "BordeauxTemplateRobot" || !catalog.catalogHash
      || JSON.stringify(generatedIds) !== JSON.stringify(expectedIds)
      || JSON.stringify(generatedConditionIds) !== JSON.stringify(["vision.targetVisible"])) {
    throw new Error(`Template catalog did not contain the expected generated capabilities (commands: ${generatedIds.join(", ")}; conditions: ${generatedConditionIds.join(", ")})`);
  }
  const structured = catalog.commands.find((command) => command.id === "example.set-output")?.parameters[0]?.schema;
  if (structured?.kind !== "object" || structured.fields?.length !== 2) {
    throw new Error("Template structured command parameter was not generated correctly");
  }
  const projectFile = await fs.readFile(path.join(fixtureRoot, "BordeauxExample.bordeaux.json"), "utf8");
  const project = decodeProjectFile(projectFile).project;
  project.paths[0].markers = [{
    id: "integration-print",
    f: 0.2,
    name: "Print",
    invocation: { commandId: "example.print-message", arguments: { message: "Hello from integration" } },
  }, {
    id: "integration-output",
    f: 0.4,
    name: "Output",
    invocation: { commandId: "example.set-output", arguments: { request: { output: 0.35, signal: "READY" } } },
  }, {
    id: "integration-hold",
    f: 0.6,
    name: "Hold",
    invocation: { commandId: "example.hold-output", arguments: { output: 0.25 }, cancelOnPathEnd: true },
  }, {
    id: "integration-status",
    f: 0.8,
    name: "Status",
    invocation: { commandId: "example.set-status", arguments: { signal: "SCORE" } },
  }];
  const trajectory = buildJavaTrajectory(project, catalog);
  if (trajectory.eventCount !== 4 || trajectory.document.paths[0]?.events.length !== 4) {
    throw new Error("Template Bordeaux project did not export all four example events");
  }
  const deployDirectory = path.join(fixtureRoot, "src", "main", "deploy", "bordeaux");
  await fs.mkdir(deployDirectory, { recursive: true });
  await fs.writeFile(path.join(deployDirectory, javaTrajectoryFileName(project.name)), trajectory.contents);
  const wrapper = path.join(fixtureRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await execFileAsync(wrapper, ["build", "--no-daemon", "--console=plain"], {
    cwd: fixtureRoot,
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 180_000,
  });

  const waitProject = createDemoProject();
  waitProject.paths[0].id = "integration-path";
  waitProject.editor.activePathId = "integration-path";
  waitProject.routines[0].nodes = [{
    id: "integration-path-node",
    type: "path",
    ref: "integration-path",
  }, {
    id: "integration-ready",
    type: "decision",
    cond: "ready",
    thenLabel: "ready",
    elseLabel: "not ready",
    then: [{
      id: "integration-wait",
      type: "builtin",
      builtinId: "bordeaux.wait",
      arguments: { durationS: 0.25 },
    }, {
      id: "integration-collect",
      type: "function",
      cat: "command",
      invocation: { commandId: "collect", arguments: {} },
    }],
    else: [],
  }];
  const runtimeCatalog = {
    projectName: "Runtime integration",
    sourceFileCount: 1,
    scannedAt: new Date(0).toISOString(),
    authoritative: true,
    generatedSchemaVersion: "1.2",
    catalogId: "test-bindings",
    supportVersion: "0.3.0",
    catalogHash: `sha256:${"a".repeat(64)}`,
    commands: [{
      id: "collect", label: "Collect", ownerType: "integration.Commands", member: "collect",
      kind: "factory", confidence: "confirmed", runtimeReady: true, parameters: [],
      source: { file: "integration/Commands.java", line: 1 },
    }],
    conditions: [{
      id: "ready", label: "Ready", ownerType: "integration.Conditions", member: "ready",
      source: { file: "integration/Conditions.java", line: 1 },
    }],
    builtIns: catalog.builtIns,
    warnings: [],
  };
  const waitFixture = path.join(fixtureRoot, "desktop-wait-integration.bordeaux.json");
  await fs.writeFile(waitFixture, buildJavaTrajectory(waitProject, runtimeCatalog).contents);
  await execFileAsync(path.join(repositoryRoot, "java", process.platform === "win32" ? "gradlew.bat" : "gradlew"), [
    "-p", path.join(repositoryRoot, "java"),
    ":runtime:test",
    "--tests", "dev.bordeaux.runtime.BordeauxRuntimeTest.executesDesktopExportedWaitRoutine",
    "--no-daemon",
    "--console=plain",
  ], {
    cwd: repositoryRoot,
    env: { ...process.env, BORDEAUX_WAIT_INTEGRATION_FIXTURE: waitFixture },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 180_000,
  });
  console.log(`Verified Bordeaux template robot (${catalog.catalogHash.slice(0, 19)}…, ${generatedIds.length} commands, ${generatedConditionIds.length} condition).`);
  console.log("Verified desktop-exported path → generated condition → Wait → generated command runtime flow.");
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
