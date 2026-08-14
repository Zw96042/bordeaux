import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const targetArgument = process.argv[2];
if (!targetArgument) throw new Error("Usage: node scripts/stage-java-maven.mjs <site-directory>");

const repositoryRoot = process.cwd();
const releaseRoot = path.join(repositoryRoot, "java", "build", "release");
const targetRoot = path.resolve(targetArgument);
const vendorSource = (await fs.readdir(releaseRoot)).find((entry) => /^BordeauxLib\d{4}\.json$/.test(entry));
if (!vendorSource) throw new Error("Java release bundle does not contain a vendordep JSON");
await fs.mkdir(targetRoot, { recursive: true });

const sourceVendorContents = await fs.readFile(path.join(releaseRoot, vendorSource));
const targetVendorPath = path.join(targetRoot, vendorSource);
try {
  const existingContents = await fs.readFile(targetVendorPath);
  const existing = JSON.parse(existingContents.toString("utf8"));
  const incoming = JSON.parse(sourceVendorContents.toString("utf8"));
  if (existing.version === incoming.version && !existingContents.equals(sourceVendorContents)) {
    throw new Error(`Refusing to replace published vendordep version ${incoming.version}`);
  }
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
await fs.writeFile(targetVendorPath, sourceVendorContents);

async function copyMavenTree(sourceDirectory, destinationDirectory, relative = "") {
  await fs.mkdir(destinationDirectory, { recursive: true });
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Release bundle contains a symbolic link: ${path.join(relative, entry.name)}`);
    const source = path.join(sourceDirectory, entry.name);
    const destination = path.join(destinationDirectory, entry.name);
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      await copyMavenTree(source, destination, childRelative);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Release bundle contains an unsupported entry: ${childRelative}`);
    const incoming = await fs.readFile(source);
    try {
      const existing = await fs.readFile(destination);
      const metadata = /(^|[/\\])maven-metadata\.xml(?:\.(?:md5|sha1|sha256|sha512))?$/.test(childRelative);
      if (!metadata && !existing.equals(incoming)) {
        throw new Error(`Refusing to replace immutable Maven artifact: ${childRelative}`);
      }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(destination, incoming);
  }
}

await copyMavenTree(path.join(releaseRoot, "maven"), path.join(targetRoot, "maven"));
await fs.writeFile(path.join(targetRoot, ".nojekyll"), "");
console.log(`Staged ${vendorSource} and Maven artifacts in ${targetRoot}.`);
