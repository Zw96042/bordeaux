import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const source = path.join(root, "Bordeaux (standalone).html");
const html = fs.readFileSync(source, "utf8");
const manifestMatch = html.match(
  /<script type="__bundler\/manifest">([\s\S]*?)<\/script>/,
);

if (!manifestMatch) {
  throw new Error("Could not find standalone bundle manifest");
}

const manifest = JSON.parse(manifestMatch[1]);
const templateMatch = html.match(
  /<script type="__bundler\/template">([\s\S]*?)<\/script>/,
);

if (!templateMatch) {
  throw new Error("Could not find standalone bundle template");
}

const template = JSON.parse(templateMatch[1]);

function bytesFor(entry) {
  const raw = Buffer.from(entry.data, "base64");
  return entry.compressed ? zlib.gunzipSync(raw) : raw;
}

function writeGeneratedPm(id, text) {
  const output = transformMathJs(text)
    .replace(
      /^\/\/ Bordeaux — path math engine \(no React\)\. Exports to window\.PM\n\(function \(\) \{\n/,
      "// @ts-nocheck\n// Generated from Bordeaux (standalone).html. Do not edit by hand.\n",
    )
    .replace(
      /\n\s*window\.PM = \{([\s\S]*?)\};\n\}\)\(\);\s*$/,
      "\nexport const PM = {$1};\nexport default PM;\n",
    );

  if (!output.includes("export const PM")) {
    throw new Error(`Failed to transform PM bundle ${id}`);
  }

  fs.writeFileSync(path.join(root, "src/shared/math/pm.ts"), output);
}

function replaceOnce(text, search, replacement, label) {
  if (!text.includes(search)) {
    throw new Error(`Could not patch ${label}`);
  }
  return text.replace(search, replacement);
}

function transformMathJs(text) {
  if (!text.startsWith("// Bordeaux — path math engine")) return text;

  const start = text.indexOf("  function sample(waypoints, perSeg = 60) {");
  const end = text.indexOf("\n\n  // ---- trapezoidal velocity profile", start);
  if (start < 0 || end < 0) {
    throw new Error("Could not find PM sample() for clothoid blend patch");
  }

  const replacement = `  function sample(waypoints, perSeg = 60) {
    const pts = [];
    const segs = waypoints.length - 1;
    if (segs < 1) return { pts: [], length: 0, segs: 0 };
    const steps = perSeg;

    const segTypeAt = (i) => (waypoints[i] && waypoints[i].segType) || 'bezier';
    const pointOf = (w) => ({ x: w.x, y: w.y });
    const chordHeading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    const outHeading = (i) => {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = pointOf(w0), p1 = pointOf(w1), c0 = w0.nextC || p1;
      return Math.hypot(c0.x - p0.x, c0.y - p0.y) > 1e-6 ? Math.atan2(c0.y - p0.y, c0.x - p0.x) : chordHeading(p0, p1);
    };
    const inHeading = (i) => {
      const w0 = waypoints[i - 1], w1 = waypoints[i];
      const p0 = pointOf(w0), p1 = pointOf(w1), c1 = w1.prevC || p0;
      return Math.hypot(p1.x - c1.x, p1.y - c1.y) > 1e-6 ? Math.atan2(p1.y - c1.y, p1.x - c1.x) : chordHeading(p0, p1);
    };
    const blendedJointHeading = (i) => {
      const prevIsClothoid = i > 0 && segTypeAt(i - 1) === 'clothoid';
      const nextIsClothoid = i < segs && segTypeAt(i) === 'clothoid';
      if (prevIsClothoid && nextIsClothoid) {
        const a = inHeading(i), b = outHeading(i);
        return a + 0.5 * angWrap(b - a);
      }
      if (prevIsClothoid) return inHeading(i);
      if (nextIsClothoid) return outHeading(i);
      return 0;
    };
    const jointHeading = waypoints.map((_, i) => blendedJointHeading(i));
