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

async function fixture(dialect: "groovy" | "kotlin" = "groovy"): Promise<{ project: string; artifacts: string }> {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-java-support-"));
  temporaryDirectories.push(project);
  const buildName = dialect === "groovy" ? "build.gradle" : "build.gradle.kts";
  await fs.writeFile(path.join(project, buildName), dialect === "groovy"
    ? "plugins { id 'edu.wpi.first.GradleRIO' version '2026.2.2' }\n"
    : "plugins { id(\"edu.wpi.first.GradleRIO\") version \"2026.2.2\" }\n");
  const wrapper = path.join(project, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await fs.writeFile(wrapper, process.platform === "win32" ? "@echo off\r\necho catalog built\r\n" : "#!/bin/sh\nprintf 'catalog built in %s\\n' \"$PWD\"\n");
  if (process.platform !== "win32") await fs.chmod(wrapper, 0o755);
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
    expect(await fs.readFile(path.join(project, ".bordeaux/INTEGRATION.md"), "utf8")).toContain("BordeauxBindings.generated(actions)");
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

