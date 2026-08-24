import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const launchRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(launchRoot);
const marketingRoot = join(repoRoot, "marketing");
const prototypeRoot = join(repoRoot, "prototypes/startup-animations");
const xmlLint = process.env.XMLLINT_BIN || "xmllint";
const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(root, predicate = () => true) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function localReference(baseFile, value, siteRoot = dirname(baseFile)) {
  if (!value || value.includes("${") || /^(?:https?:|mailto:|data:|#|%23)/.test(value)) return null;
  const clean = value.split(/[?#]/)[0];
  if (!clean) return null;
  return clean.startsWith("/") ? join(siteRoot, clean.slice(1)) : resolve(dirname(baseFile), clean);
}

function validateHtml(path, siteRoot) {
  const source = readFileSync(path, "utf8");
  const ids = [...source.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
  check(ids.length === new Set(ids).size, `${relative(repoRoot, path)} contains duplicate IDs`);

  for (const match of source.matchAll(/\s(?:src|href|poster)=["']([^"']+)["']/g)) {
    const target = localReference(path, match[1], siteRoot);
    if (target) check(existsSync(target), `${relative(repoRoot, path)} references missing ${relative(repoRoot, target)}`);
  }

  for (const match of source.matchAll(/aria-controls=["']([^"']+)["']/g)) {
    check(ids.includes(match[1]), `${relative(repoRoot, path)} aria-controls target #${match[1]} is missing`);
  }

  for (const match of source.matchAll(/<script\s+type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(match[1]);
      check(true, `${relative(repoRoot, path)} structured data parses`);
    } catch (error) {
      check(false, `${relative(repoRoot, path)} structured data is invalid: ${error.message}`);
    }
  }
}

for (const path of walk(marketingRoot, (file) => extname(file) === ".html")) validateHtml(path, marketingRoot);
validateHtml(join(prototypeRoot, "index.html"), prototypeRoot);

const siteScript = readFileSync(join(marketingRoot, "site.js"), "utf8");
try {
  new vm.Script(siteScript, { filename: "marketing/site.js" });
  check(true, "marketing/site.js parses");
} catch (error) {
  check(false, `marketing/site.js does not parse: ${error.message}`);
}

const prototypeSource = readFileSync(join(prototypeRoot, "index.html"), "utf8");
for (const [index, match] of [...prototypeSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
  try {
    new vm.Script(match[1], { filename: `prototype-inline-${index + 1}.js` });
    check(true, `prototype inline script ${index + 1} parses`);
  } catch (error) {
    check(false, `prototype inline script ${index + 1} does not parse: ${error.message}`);
  }
}

const css = readFileSync(join(marketingRoot, "styles.css"), "utf8");
for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
  const target = localReference(join(marketingRoot, "styles.css"), match[1], marketingRoot);
  if (target) check(existsSync(target), `marketing/styles.css references missing ${relative(repoRoot, target)}`);
}

for (const path of [...walk(marketingRoot), ...walk(launchRoot)].filter((file) => [".svg", ".xml"].includes(extname(file)))) {
  try {
    execFileSync(xmlLint, ["--noout", path], { stdio: "ignore" });
    check(true, `${relative(repoRoot, path)} is valid XML`);
  } catch {
    check(false, `${relative(repoRoot, path)} is not valid XML`);
  }
}

for (const path of [...walk(marketingRoot), ...walk(launchRoot), ...walk(prototypeRoot)].filter((file) => extname(file) === ".md")) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = localReference(path, match[1]);
    if (target) check(existsSync(target), `${relative(repoRoot, path)} links to missing ${relative(repoRoot, target)}`);
  }
}

for (const jsonPath of [join(marketingRoot, "site.webmanifest"), join(launchRoot, "assets/manifest.json")]) {
  try {
    JSON.parse(readFileSync(jsonPath, "utf8"));
    check(true, `${relative(repoRoot, jsonPath)} parses`);
  } catch (error) {
    check(false, `${relative(repoRoot, jsonPath)} is invalid JSON: ${error.message}`);
  }
}

const siteManifest = JSON.parse(readFileSync(join(marketingRoot, "site.webmanifest"), "utf8"));
for (const icon of siteManifest.icons ?? []) {
  check(existsSync(join(marketingRoot, icon.src.replace(/^\//, ""))), `site manifest icon is missing: ${icon.src}`);
}
const fontRoot = join(marketingRoot, "assets/fonts");
const expectedFontHashes = {
  "space-grotesk-latin.woff2": "a0d054c4af557de20afd6ca59f47ab353bcaec49c63ff04b6c9d39d0f8910557",
  "jetbrains-mono-latin.woff2": "2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4",
};
for (const [file, expectedHash] of Object.entries(expectedFontHashes)) {
  check(sha256(join(fontRoot, file)) === expectedHash, `${file} no longer matches its documented official source`);
}
check(existsSync(join(fontRoot, "FONT-LICENSES.txt")), "font license notices are missing");
check(existsSync(join(fontRoot, "SOURCES.md")), "font source record is missing");

const manifest = JSON.parse(readFileSync(join(launchRoot, "assets/manifest.json"), "utf8"));
check(manifest.canonicalLogoSource === "build/icon-assets/wine-glass.svg", "launch manifest must identify the canonical logo source");
for (const item of manifest.exports) {
  check(existsSync(join(launchRoot, item.file)), `manifest export is missing: ${item.file}`);
}
const monochromeMark = readFileSync(join(launchRoot, "assets/brand/mark-monochrome.svg"), "utf8");
const monochromeColors = [...monochromeMark.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase());
check(new Set(monochromeColors).size === 1, "monochrome mark contains more than one ink color");
for (const generatedAsset of ["assets/generated/bordeaux-brand-board.svg", "assets/generated/bordeaux-brand-board.png", "assets/generated/bordeaux-launch-key-art.png"]) {
  check(existsSync(join(launchRoot, generatedAsset)), `generated campaign asset is missing: ${generatedAsset}`);
}
const keyArtEntry = manifest.exports.find((item) => item.file === "assets/generated/bordeaux-launch-key-art.png");
check(keyArtEntry?.source === "prototypes/startup-animations/exports/spill-route.mp4", "key art must identify the reviewed Spill / Route master");
check(keyArtEntry?.sourceFrame === 78, "key art must retain the reviewed source frame");

function probeImage(relativePath, expectedWidth, expectedHeight) {
  const path = join(repoRoot, relativePath);
  const result = JSON.parse(execFileSync(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", path], { encoding: "utf8" }));
  const image = result.streams.find((stream) => stream.codec_type === "video");
  check(image?.width === expectedWidth && image?.height === expectedHeight, `${relativePath} has unexpected dimensions`);
}

function probeVideo(relativePath, expectedWidth, expectedHeight, expectedDuration) {
  const path = join(repoRoot, relativePath);
  const result = JSON.parse(execFileSync(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", path], { encoding: "utf8" }));
  const video = result.streams.find((stream) => stream.codec_type === "video");
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  check(video?.width === expectedWidth && video?.height === expectedHeight, `${relativePath} has unexpected dimensions`);
  check(Math.abs(Number(result.format.duration) - expectedDuration) < 0.05, `${relativePath} has unexpected duration ${result.format.duration}`);
  check(Boolean(audio), `${relativePath} is missing an audio stream`);
}

probeImage("launch/assets/generated/bordeaux-launch-key-art.png", 1920, 1080);
probeVideo("marketing/assets/product/bordeaux-demo.mp4", 1280, 800, 18);
probeVideo("launch/exports/bordeaux-launch-draft.mp4", 1920, 1080, 37.5);

if (failures.length) {
  console.error(`Launch validation failed (${failures.length}/${checks} checks):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Launch validation passed: ${checks} checks.`);
