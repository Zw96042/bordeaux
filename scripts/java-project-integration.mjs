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
  console.log(`Verified Bordeaux template robot (${catalog.catalogHash.slice(0, 19)}…, ${generatedIds.length} commands, ${generatedConditionIds.length} condition).`);
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
