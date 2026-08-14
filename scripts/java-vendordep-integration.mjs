import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const { applyJavaSupportInstall, prepareJavaSupportInstall } = require("../dist-electron/electron/javaSupport.js");
const repositoryRoot = process.cwd();
const properties = Object.fromEntries(
  (await fs.readFile(path.join(repositoryRoot, "java", "gradle.properties"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const version = properties.bordeauxVersion;
const frcYear = properties.bordeauxFrcYear;
const releaseRoot = path.join(repositoryRoot, "java", "build", "release");
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-vendordep-integration-"));

try {
  const source = path.join(repositoryRoot, "examples", "bordeaux-template-robot");
  await fs.cp(source, fixtureRoot, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      if (!relative) return true;
      return !relative.split(path.sep).some((part) => part === ".gradle" || part === "build" || part === ".bordeaux");
    },
  });
  if (process.platform !== "win32") await fs.chmod(path.join(fixtureRoot, "gradlew"), 0o755);
  const buildFile = path.join(fixtureRoot, "build.gradle");
  const templateBuild = await fs.readFile(buildFile, "utf8");
  const cleanBuild = templateBuild.replace(
    /\n?\/\/ BEGIN Bordeaux Java command support[\s\S]*?\/\/ END Bordeaux Java command support\n?/,
    "\n",
  );
  if (cleanBuild === templateBuild) throw new Error("GradleRIO fixture did not contain the expected managed block");
  await fs.writeFile(buildFile, cleanBuild);

  const vendorFileName = `BordeauxLib${frcYear}.json`;
  const vendor = JSON.parse(await fs.readFile(path.join(releaseRoot, vendorFileName), "utf8"));
  vendor.mavenUrls = [pathToFileURL(path.join(releaseRoot, "maven")).href, "https://repo1.maven.org/maven2"];
  const localVendorPath = path.join(fixtureRoot, `local-${vendorFileName}`);
  vendor.jsonUrl = pathToFileURL(localVendorPath).href;
  await fs.writeFile(localVendorPath, `${JSON.stringify(vendor, null, 2)}\n`);

  const wrapper = path.join(fixtureRoot, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  await execFileAsync(wrapper, ["vendordep", `--url=${pathToFileURL(localVendorPath).href}`, "--no-daemon", "--console=plain"], {
    cwd: fixtureRoot,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  });

  const support = await prepareJavaSupportInstall(fixtureRoot, path.join(repositoryRoot, "java", "dist"));
  await applyJavaSupportInstall(support);
  const managedScript = await fs.readFile(path.join(fixtureRoot, ".bordeaux", "bordeaux.gradle"), "utf8");
  if (!managedScript.includes("annotationProcessor 'dev.bordeaux:bordeaux-java:")
      || managedScript.includes("bordeaux-runtime.jar")) {
    throw new Error("Desktop integration did not select the installed vendordep");
  }

  await execFileAsync(wrapper, ["clean", "bordeauxCatalog", "build", "--no-daemon", "--console=plain"], {
    cwd: fixtureRoot,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  });

  const catalog = JSON.parse(await fs.readFile(path.join(fixtureRoot, "build", "bordeaux", "catalog-v1.json"), "utf8"));
  const commandIds = catalog.commands.map((command) => command.id).sort();
  const expectedIds = ["example.hold-output", "example.print-message", "example.set-output", "example.set-status"];
  if (catalog.supportVersion !== version || JSON.stringify(commandIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`Vendordep consumer generated an unexpected command catalog: ${commandIds.join(", ")}`);
  }

  const libraries = (await fs.readdir(path.join(fixtureRoot, "build", "libs")))
    .filter((entry) => entry.endsWith(".jar") && !entry.endsWith("-sources.jar"));
  if (libraries.length !== 1) throw new Error(`Expected one robot JAR, found: ${libraries.join(", ")}`);
  const jarExecutable = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "jar.exe" : "jar")
    : "jar";
  const { stdout: jarEntries } = await execFileAsync(jarExecutable, ["tf", path.join(fixtureRoot, "build", "libs", libraries[0])], {
    maxBuffer: 4 * 1024 * 1024,
  });
  for (const required of [
    "dev/bordeaux/runtime/BordeauxPathRunner.class",
    "dev/bordeaux/generated/BordeauxGeneratedBindings.class",
  ]) {
    if (!jarEntries.split(/\r?\n/).includes(required)) throw new Error(`Vendordep robot JAR is missing ${required}`);
  }
  try {
    await fs.access(path.join(fixtureRoot, ".bordeaux", "lib", "bordeaux-runtime.jar"));
    throw new Error("Vendordep integration unexpectedly depended on an app-copied runtime JAR");
  } catch (error) {
    if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
  }

  console.log(`Verified clean GradleRIO vendordep consumer (${version}, ${commandIds.length} commands).`);
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
