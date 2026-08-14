import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const javaRoot = path.join(repositoryRoot, "java");
const releaseRoot = path.join(javaRoot, "build", "release");
const expectedLicense = "Apache-2.0";
const properties = Object.fromEntries(
  fs.readFileSync(path.join(javaRoot, "gradle.properties"), "utf8")
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
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
  throw new Error("java/gradle.properties must define a publishable bordeauxVersion");
}
if (!/^20\d{2}$/.test(frcYear ?? "")) throw new Error("java/gradle.properties must define bordeauxFrcYear");

const supportSources = [
  ["desktop support", path.join(repositoryRoot, "src", "electron", "javaSupport.ts")],
  ["annotation processor", path.join(javaRoot, "processor", "src", "main", "java", "dev", "bordeaux", "processor", "BordeauxProcessor.java")],
  ["trajectory reader", path.join(javaRoot, "runtime", "src", "main", "java", "dev", "bordeaux", "runtime", "BordeauxTrajectoryReader.java")],
];
for (const [label, file] of supportSources) {
  if (!fs.readFileSync(file, "utf8").includes(version)) {
    throw new Error(`${label} does not declare Java support version ${version}`);
  }
}

const vendorName = `BordeauxLib${frcYear}.json`;
const vendorPath = path.join(releaseRoot, vendorName);
const vendor = JSON.parse(fs.readFileSync(vendorPath, "utf8"));
const expectedRepository = "https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven";
if (vendor.fileName !== vendorName || vendor.name !== "BordeauxLib" || vendor.version !== version
    || vendor.frcYear !== frcYear || vendor.uuid !== "eafa3419-00b5-4089-9035-7924013acc7b"
    || vendor.jsonUrl !== `${expectedRepository}/${vendorName}`
    || !Array.isArray(vendor.mavenUrls) || vendor.mavenUrls[0] !== `${expectedRepository}/maven/`
    || JSON.stringify(vendor.javaDependencies) !== JSON.stringify([{
      groupId: "dev.bordeaux", artifactId: "bordeaux-java", version,
    }])
    || !Array.isArray(vendor.jniDependencies) || vendor.jniDependencies.length !== 0
    || !Array.isArray(vendor.cppDependencies) || vendor.cppDependencies.length !== 0) {
  throw new Error(`${vendorName} does not match the Bordeaux ${version} release contract`);
}

for (const moduleName of ["bordeaux-annotations", "bordeaux-processor", "bordeaux-runtime", "bordeaux-java"]) {
  const moduleRoot = path.join(releaseRoot, "maven", "dev", "bordeaux", moduleName, version);
  const jar = path.join(moduleRoot, `${moduleName}-${version}.jar`);
  const pom = path.join(moduleRoot, `${moduleName}-${version}.pom`);
  const sources = path.join(moduleRoot, `${moduleName}-${version}-sources.jar`);
  for (const artifact of [jar, pom, sources]) {
    if (!fs.statSync(artifact).isFile() || fs.statSync(artifact).size === 0) {
      throw new Error(`Missing Java release artifact: ${path.relative(repositoryRoot, artifact)}`);
    }
    const expectedHash = fs.readFileSync(`${artifact}.sha256`, "utf8").trim();
    const actualHash = createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Invalid SHA-256 sidecar for ${path.basename(artifact)}`);
  }
  const pomContents = fs.readFileSync(pom, "utf8");
  if (!pomContents.includes("<groupId>dev.bordeaux</groupId>")
      || !pomContents.includes(`<artifactId>${moduleName}</artifactId>`)
      || !pomContents.includes(`<version>${version}</version>`)) {
    throw new Error(`${moduleName} POM has incorrect coordinates`);
  }
  const flatArtifact = path.join(releaseRoot, "artifacts", `${moduleName}-${version}.jar`);
  if (!fs.statSync(flatArtifact).isFile()) throw new Error(`Missing flat release artifact ${path.basename(flatArtifact)}`);
}

const runtimePom = fs.readFileSync(
  path.join(releaseRoot, "maven", "dev", "bordeaux", "bordeaux-java", version, `bordeaux-java-${version}.pom`),
  "utf8",
);
if (!runtimePom.includes("<groupId>com.fasterxml.jackson.core</groupId>")
    || !runtimePom.includes("<artifactId>jackson-databind</artifactId>")) {
  throw new Error("Vendordep POM does not carry its Jackson dependency");
}
if (!runtimePom.includes("<name>Apache License, Version 2.0</name>")
    || !runtimePom.includes("<url>https://www.apache.org/licenses/LICENSE-2.0.txt</url>")) {
  throw new Error("Vendordep POM does not declare the Apache-2.0 license");
}

const packageMetadata = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
if (packageMetadata.license !== expectedLicense) {
  throw new Error(`package.json must declare ${expectedLicense}`);
}

if (process.argv.includes("--publish")) {
  const expectedTag = `java-v${version}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(`Java releases must run from tag ${expectedTag}`);
  }
  const licenseContents = fs.readFileSync(path.join(repositoryRoot, "LICENSE"), "utf8");
  if (!licenseContents.includes("Apache License") || !licenseContents.includes("Version 2.0, January 2004")) {
    throw new Error("Public Java release requires the Apache-2.0 repository LICENSE");
  }
}

console.log(`Verified BordeauxLib ${version} for FRC ${frcYear} (${vendor.javaDependencies.length} runtime dependency).`);
