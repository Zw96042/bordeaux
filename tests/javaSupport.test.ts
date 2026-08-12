import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyJavaSupportInstall,
  cancelJavaCatalogBuild,
  inspectJavaSupport,
  prepareJavaSupportInstall,
  runJavaCatalogBuild,
  windowsGradleCommand,
} from "../src/electron/javaSupport";
import type { JavaCommandCatalog } from "../src/shared/types";

const temporaryDirectories: string[] = [];

async function writeWrapper(project: string, posixScript: string, windowsScript: string): Promise<void> {
  const wrapper = path.join(project, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await fs.writeFile(wrapper, process.platform === "win32" ? windowsScript : posixScript);
  if (process.platform !== "win32") await fs.chmod(wrapper, 0o755);
}

async function fixture(dialect: "groovy" | "kotlin" = "groovy"): Promise<{ project: string; artifacts: string }> {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-support-"));
  temporaryDirectories.push(project);
  const buildName = dialect === "groovy" ? "build.gradle" : "build.gradle.kts";
  await fs.writeFile(path.join(project, buildName), dialect === "groovy"
    ? "plugins { id 'edu.wpi.first.GradleRIO' version '2026.2.2' }\n"
    : "plugins { id(\"edu.wpi.first.GradleRIO\") version \"2026.2.2\" }\n");
  await writeWrapper(project, "#!/bin/sh\nprintf 'catalog built in %s\\n' \"$PWD\"\n", "@echo off\r\necho catalog built in %CD%\r\n");
  const artifacts = path.join(project, "artifacts");
  await fs.mkdir(artifacts);
  await fs.writeFile(path.join(artifacts, "bordeaux-runtime.jar"), "runtime");
  await fs.writeFile(path.join(artifacts, "bordeaux-processor.jar"), "processor");
  return { project, artifacts };
}

function sourceCatalog(): JavaCommandCatalog {
  return { projectName: "Robot", sourceFileCount: 1, scannedAt: "now", commands: [], warnings: [], authoritative: false };
}

afterEach(async () => {
  cancelJavaCatalogBuild();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Java support installation and trusted catalog builds", () => {
  it("quotes Windows wrapper paths and rejects cmd.exe metacharacters", () => {
    expect(windowsGradleCommand("C:\\Robot Projects\\gradlew.bat", ["bordeauxCatalog", "--no-daemon"]))
      .toBe('"C:\\Robot Projects\\gradlew.bat" bordeauxCatalog --no-daemon');
    expect(() => windowsGradleCommand("C:\\Robot&Other\\gradlew.bat", ["bordeauxCatalog"]))
      .toThrow(/cannot be launched safely/);
  });

  it.each(["groovy", "kotlin"] as const)("installs an idempotent managed block for %s Gradle", async (dialect) => {
    const { project, artifacts } = await fixture(dialect);
    const first = await prepareJavaSupportInstall(project, artifacts);
    await applyJavaSupportInstall(first);
    const second = await prepareJavaSupportInstall(project, artifacts);
    await applyJavaSupportInstall(second);

    const buildName = dialect === "groovy" ? "build.gradle" : "build.gradle.kts";
    const contents = await fs.readFile(path.join(project, buildName), "utf8");
    expect(contents.match(/BEGIN Bordeaux Java command support/g)).toHaveLength(1);
    expect(contents).toContain(dialect === "groovy" ? "apply from: file('.bordeaux/bordeaux.gradle')" : "apply(from = file(\".bordeaux/bordeaux.gradle\"))");
    expect(await fs.readFile(path.join(project, ".bordeaux/lib/bordeaux-runtime.jar"), "utf8")).toBe("runtime");
    const integrationGuide = await fs.readFile(path.join(project, ".bordeaux/INTEGRATION.md"), "utf8");
    expect(integrationGuide).toContain("BordeauxBindings.generated(actions)");
    expect(integrationGuide).toContain("void autonomousPeriodic(double elapsedSeconds, double measuredFraction)");
    expect(integrationGuide).toContain("bordeauxEvents.periodic(elapsedSeconds, measuredFraction)");
    expect(integrationGuide).not.toContain("bordeauxEvents.periodic(elapsedSeconds);");
    expect(await fs.readFile(path.join(project, ".bordeaux/bordeaux.gradle"), "utf8")).toContain("-Abordeaux.catalogId=");
    expect(await fs.readFile(path.join(project, `.bordeaux/${buildName}.before-bordeaux`), "utf8")).toContain("GradleRIO");
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: true, supportVersion: "0.1.0", wrapperAvailable: true });
    const applyLine = dialect === "groovy" ? "apply from: file('.bordeaux/bordeaux.gradle')" : "apply(from = file(\".bordeaux/bordeaux.gradle\"))";
    await fs.writeFile(path.join(project, buildName), contents.replace(applyLine, ""));
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: false });
    await fs.writeFile(path.join(project, buildName), contents);
    await fs.writeFile(path.join(project, ".bordeaux/lib/bordeaux-runtime.jar"), "corrupted");
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: false });
  });

  it("keeps shipped Java examples on the measured-progress event API", async () => {
    const sources = await Promise.all([
      fs.readFile(path.join(process.cwd(), "java/examples/RobotContainerSnippet.java"), "utf8"),
      fs.readFile(path.join(process.cwd(), "examples/bordeaux-template-robot/src/main/java/frc/robot/RobotContainer.java"), "utf8"),
    ]);

    sources.forEach((source) => {
      expect(source).toContain("periodic(elapsedS, measuredFraction)");
      expect(source).not.toContain("periodic(elapsedS);");
    });
  });

  it("rejects ambiguous projects, missing GradleRIO, and symlinked support directories", async () => {
    const ambiguous = await fixture();
    await fs.writeFile(path.join(ambiguous.project, "build.gradle.kts"), "plugins {}\n");
    await expect(prepareJavaSupportInstall(ambiguous.project, ambiguous.artifacts)).rejects.toThrow(/exactly one/);

    const plain = await fixture();
    await fs.writeFile(path.join(plain.project, "build.gradle"), "plugins { id 'java' }\n");
    await expect(prepareJavaSupportInstall(plain.project, plain.artifacts)).rejects.toThrow(/GradleRIO/);

    const linked = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-support-outside-"));
    temporaryDirectories.push(outside);
    await fs.symlink(outside, path.join(linked.project, ".bordeaux"));
    await expect(prepareJavaSupportInstall(linked.project, linked.artifacts)).rejects.toThrow(/regular directory/);
  });

  it("bounds project-controlled files before Java support inspection reads them", async () => {
    const { project, artifacts } = await fixture();
    const buildFile = path.join(project, "build.gradle");
    await fs.writeFile(buildFile, Buffer.alloc(2 * 1024 * 1024 + 1, 0x20));
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).rejects.toThrow(/2097152-byte limit/);

    await fs.writeFile(buildFile, "plugins { id 'edu.wpi.first.GradleRIO' version '2026.2.2' }\n");
    await fs.mkdir(path.join(project, ".bordeaux"));
    await fs.writeFile(path.join(project, ".bordeaux/install.json"), Buffer.alloc(64 * 1024 + 1, 0x20));
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: false });
  });

  it("distinguishes missing Java artifacts from invalid ones", async () => {
    const missing = await fixture();
    await fs.rm(path.join(missing.artifacts, "bordeaux-runtime.jar"));
    await expect(prepareJavaSupportInstall(missing.project, missing.artifacts)).rejects.toThrow(/artifacts are missing/);

    const invalid = await fixture();
    await fs.rm(path.join(invalid.artifacts, "bordeaux-runtime.jar"));
    await fs.mkdir(path.join(invalid.artifacts, "bordeaux-runtime.jar"));
    await expect(prepareJavaSupportInstall(invalid.project, invalid.artifacts)).rejects.toThrow(/must be a regular file/);
  });

  it("runs only the fixed wrapper task and redacts the project path", async () => {
    const { project } = await fixture();
    const result = await runJavaCatalogBuild(project);
    expect(result.output).toContain("catalog built in <robot-project>");
    expect(result.output).not.toContain(project);
  });

  it("enforces output, timeout, cancellation, and one-build-at-a-time limits", async () => {
    const noisy = await fixture();
    await writeWrapper(noisy.project, "#!/bin/sh\nyes x | head -c 4096\n", "@echo off\r\nfor /L %%i in (1,1,200) do @echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\r\n");
    await expect(runJavaCatalogBuild(noisy.project, { outputBytes: 128 })).rejects.toThrow(/output limit/);

    const slow = await fixture();
    await writeWrapper(slow.project, "#!/bin/sh\nsleep 5\n", "@echo off\r\nping 127.0.0.1 -n 6 >nul\r\n");
    await expect(runJavaCatalogBuild(slow.project, { timeoutMs: 30, killGraceMs: 30 })).rejects.toThrow(/time limit/);

    const stubborn = await fixture();
    await writeWrapper(stubborn.project, "#!/bin/sh\ntrap '' TERM\nwhile :; do sleep 1; done\n", "@echo off\r\nping 127.0.0.1 -n 6 >nul\r\n");
    await expect(runJavaCatalogBuild(stubborn.project, { timeoutMs: 30, killGraceMs: 30 })).rejects.toThrow(/time limit/);

    const cancel = await fixture();
    await writeWrapper(cancel.project, "#!/bin/sh\nsleep 5\n", "@echo off\r\nping 127.0.0.1 -n 6 >nul\r\n");
    const running = runJavaCatalogBuild(cancel.project, { timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(runJavaCatalogBuild(cancel.project)).rejects.toThrow(/already running/);
    expect(cancelJavaCatalogBuild()).toBe(true);
    await expect(running).rejects.toThrow(/canceled/);
  });
});
