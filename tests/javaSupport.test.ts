import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyJavaSupportInstall,
  cancelJavaCatalogBuild,
  inspectJavaSupport,
  installPreviewSummary,
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

async function installVendordep(project: string): Promise<void> {
  const directory = path.join(project, "vendordeps");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "BordeauxLib2026.json"), JSON.stringify({
    fileName: "BordeauxLib2026.json",
    name: "BordeauxLib",
    version: "0.1.0",
    uuid: "eafa3419-00b5-4089-9035-7924013acc7b",
    frcYear: "2026",
    mavenUrls: ["https://example.invalid/maven"],
    jsonUrl: "https://example.invalid/BordeauxLib2026.json",
    javaDependencies: [{ groupId: "dev.bordeaux", artifactId: "bordeaux-java", version: "0.1.0" }],
    jniDependencies: [],
    cppDependencies: [],
  }));
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
    expect(integrationGuide).toContain("void autonomousPeriodic(double dtSeconds, double measuredX, double measuredY, double measuredFraction)");
    expect(integrationGuide).toContain("bordeauxPath.update(dtSeconds, measuredX, measuredY, measuredFraction)");
    expect(integrationGuide).not.toContain("BordeauxEventRunner");
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

  it("uses an installed matching vendordep without copying bundled jars", async () => {
    const { project, artifacts } = await fixture();
    await installVendordep(project);

    const preview = await prepareJavaSupportInstall(project, artifacts);
    expect(installPreviewSummary(preview)).toMatchObject({ installMode: "vendordep" });
    expect(installPreviewSummary(preview).files).not.toContain(".bordeaux/lib/bordeaux-runtime.jar");
    await applyJavaSupportInstall(preview);

    const script = await fs.readFile(path.join(project, ".bordeaux/bordeaux.gradle"), "utf8");
    expect(script).toContain("implementation wpi.java.vendor.java()");
    expect(script).toContain("annotationProcessor 'dev.bordeaux:bordeaux-java:0.1.0'");
    expect(script).not.toContain("bordeaux-runtime.jar");
    await expect(fs.stat(path.join(project, ".bordeaux/lib/bordeaux-runtime.jar"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: true });

    await fs.writeFile(path.join(project, "vendordeps/BordeauxLib2026.json"), "{}");
    await expect(inspectJavaSupport(project, sourceCatalog(), artifacts)).resolves.toMatchObject({ installed: false });
  });

  it("rejects a vendordep changed after the install preview", async () => {
    const { project, artifacts } = await fixture();
    await installVendordep(project);
    const preview = await prepareJavaSupportInstall(project, artifacts);

    await fs.writeFile(path.join(project, "vendordeps/BordeauxLib2026.json"), "{}");

    await expect(applyJavaSupportInstall(preview)).rejects.toThrow(/vendordep changed/);
    await expect(fs.stat(path.join(project, ".bordeaux/install.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ships a path-following example that keeps measured and lookahead progress separate", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "java/examples/RobotContainerSnippet.java"), "utf8",
    );

    expect(source).toContain("new BordeauxPathRunner(path, bordeauxCommands)");
    expect(source).toContain("drivetrain.measuredPathFraction()");
    expect(source).toContain("drivetrain.follow(reference)");
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

  it("atomically admits only one simultaneous catalog build", async () => {
    const { project } = await fixture();
    await writeWrapper(project,
      "#!/bin/sh\nprintf 'started\\n' >> build-starts\nsleep 0.05\n",
      "@echo off\r\necho started>>build-starts\r\nping 127.0.0.1 -n 2 >nul\r\n");

    const outcomes = await Promise.allSettled([runJavaCatalogBuild(project), runJavaCatalogBuild(project)]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: expect.stringMatching(/already running/) }) });
    expect((await fs.readFile(path.join(project, "build-starts"), "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("cancels an admitted catalog build before delayed preflight can spawn", async () => {
    const { project } = await fixture();
    await writeWrapper(project,
      "#!/bin/sh\nprintf 'started\\n' >> build-starts\n",
      "@echo off\r\necho started>>build-starts\r\n");
    const originalRealpath = fs.realpath.bind(fs);
    let releasePreflight!: () => void;
    let markPreflightStarted!: () => void;
    const preflightStarted = new Promise<void>((resolve) => { markPreflightStarted = resolve; });
    const preflightRelease = new Promise<void>((resolve) => { releasePreflight = resolve; });
    const realpath = vi.spyOn(fs, "realpath").mockImplementationOnce(async (target) => {
      markPreflightStarted();
      await preflightRelease;
      return originalRealpath(target);
    });
    try {
      const running = runJavaCatalogBuild(project);
      await preflightStarted;
      const canceled = cancelJavaCatalogBuild(true);
      releasePreflight();
      const [outcome] = await Promise.allSettled([running]);

      expect(canceled).toBe(true);
      expect(outcome).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringMatching(/canceled/) }) });
      await expect(fs.stat(path.join(project, "build-starts"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      releasePreflight();
      realpath.mockRestore();
    }
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
