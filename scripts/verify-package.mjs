import { extractFile, listPackage } from "@electron/asar";
import fs from "node:fs";
import path from "node:path";

const MAX_ASAR_BYTES = 8 * 1024 * 1024;
const repositoryManifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
const requiredEntries = [
  "package.json",
  repositoryManifest.main,
  "dist-electron/electron/javaTrajectoryWorker.js",
  "public/renderer/index.html",
  "public/renderer/assets/react.production.min.js",
  "public/renderer/assets/react-dom.production.min.js",
  "node_modules/@modelcontextprotocol/server/package.json",
  "node_modules/zod/package.json",
];
const requiredResources = [
  "java/bordeaux-processor.jar",
  "java/bordeaux-runtime.jar",
];

function collectArchives(target, archives) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (path.basename(target) === "app.asar") archives.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    collectArchives(path.join(target, entry.name), archives);
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("release");
const archives = [];
for (const target of targets) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) throw new Error(`Packaged output does not exist: ${target}`);
  collectArchives(resolved, archives);
}
if (archives.length === 0) throw new Error(`No app.asar found under: ${targets.join(", ")}`);

for (const archive of archives) {
  const archiveBytes = fs.statSync(archive).size;
  if (archiveBytes > MAX_ASAR_BYTES) {
    throw new Error(`${archive} is ${archiveBytes.toLocaleString()} bytes; budget is ${MAX_ASAR_BYTES.toLocaleString()} bytes`);
  }

  const entries = listPackage(archive, { isPack: false })
    .map((entry) => entry.replace(/^[/\\]+/, "").replaceAll("\\", "/"));
  const entrySet = new Set(entries);
  for (const required of requiredEntries) {
    if (!entrySet.has(required)) throw new Error(`${archive} is missing required entry: ${required}`);
  }

  const forbidden = entries.find((entry) =>
    /(^|\/)(?:tests?|__tests__)\//i.test(entry)
    || /\.(?:test|spec)\.[^/]+$/i.test(entry)
    || /\.(?:map|d\.[cm]?ts|[cm]?ts|tsx)$/i.test(entry)
    || /react(?:-dom)?\.development(?:\.min)?\.js$/i.test(entry));
  if (forbidden) throw new Error(`${archive} contains development-only content: ${forbidden}`);

  const packagedManifest = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
  for (const field of ["name", "version", "main"]) {
    if (packagedManifest[field] !== repositoryManifest[field]) {
      throw new Error(`${archive} package.json has unexpected ${field}: ${packagedManifest[field]}`);
    }
  }

  const rendererHtml = extractFile(archive, "public/renderer/index.html").toString("utf8");
  if (/react(?:-dom)?\.development(?:\.min)?\.js/i.test(rendererHtml)
      || !rendererHtml.includes("assets/react.production.min.js")
      || !rendererHtml.includes("assets/react-dom.production.min.js")) {
    throw new Error(`${archive} renderer does not load the vendored production React assets`);
  }

  const resourcesDirectory = path.dirname(archive);
  for (const resource of requiredResources) {
    const file = path.join(resourcesDirectory, resource);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`${archive} is missing packaged resource: ${resource}`);
    }
  }

  console.log(`Verified ${path.relative(process.cwd(), archive)} (${entries.length} entries, ${archiveBytes.toLocaleString()} bytes)`);
}
