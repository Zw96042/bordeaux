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
    const clothoidSegments = new Set();

    for (let i = 0; i < segs; i++) {
      const w0 = waypoints[i], w1 = waypoints[i + 1];
      const p0 = { x: w0.x, y: w0.y }, p1 = { x: w1.x, y: w1.y };
      const c0 = w0.nextC, c1 = w1.prevC;
      let type = w0.segType || 'bezier';
      let arc = null, cloth = null, effType = type;
      if (type === 'arc') { arc = arcSetup(p0, p1, c0); if (!arc) effType = 'line'; }
      else if (type === 'clothoid') {
        const th0 = (i > 0 && segTypeAt(i - 1) === 'clothoid') ? jointHeading[i] : outHeading(i);
        const th1 = (i + 1 < segs && segTypeAt(i + 1) === 'clothoid') ? jointHeading[i + 1] : inHeading(i + 1);
        cloth = clothoidTable(p0, p1, th0, th1, steps); if (!cloth) effType = 'bezier';
      }
      if (effType === 'clothoid') clothoidSegments.add(i);
      for (let k = 0; k <= steps; k++) {
        if (i > 0 && k === 0) continue; // avoid dup at seg joints
        const t = k / steps;
        let pos, head, curv;
        if (effType === 'line') {
          pos = { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) };
          head = Math.atan2(p1.y - p0.y, p1.x - p0.x); curv = 0;
        } else if (effType === 'arc') {
          const ang = arc.a0 + arc.sweep * t;
          pos = { x: arc.Cx + arc.rad * Math.cos(ang), y: arc.Cy + arc.rad * Math.sin(ang) };
          head = ang + (arc.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);
          curv = arc.rad > 1e-6 ? 1 / arc.rad : 0;
        } else if (effType === 'clothoid') {
          pos = { x: cloth.xs[k], y: cloth.ys[k] }; head = cloth.hs[k]; curv = Math.abs(cloth.ks[k]);
        } else {
          pos = bez(p0, c0, c1, p1, t);
          const d = bezD(p0, c0, c1, p1, t), dd = bezDD(p0, c0, c1, p1, t);
          const speed2 = d.x * d.x + d.y * d.y, cross = d.x * dd.y - d.y * dd.x;
          head = Math.atan2(d.y, d.x); curv = speed2 > 1e-9 ? Math.abs(cross) / Math.pow(speed2, 1.5) : 0;
        }
        pts.push({ x: pos.x, y: pos.y, seg: i, t, heading: head, curv, s: 0 });
      }
    }

    // Blend curvature across adjacent clothoid joints. Position/heading already use a shared
    // tangent; this removes artificial velocity dips from independent curvature estimates.
    for (let j = 1; j < segs; j++) {
      if (!clothoidSegments.has(j - 1) || !clothoidSegments.has(j)) continue;
      const center = pts.findIndex((p) => p.seg === j - 1 && p.t > 1 - 1e-9);
      if (center < 0) continue;
      const next = Math.min(pts.length - 1, center + 1);
      const jointK = 0.5 * ((pts[center].curv || 0) + (pts[next].curv || 0));
      const span = Math.max(2, Math.round(steps * 0.16));
      for (let off = -span; off <= span; off++) {
        const idx = center + off;
        if (idx < 0 || idx >= pts.length) continue;
        if (!clothoidSegments.has(pts[idx].seg)) continue;
        const u = 1 - Math.min(1, Math.abs(off) / span);
        const w = u * u * (3 - 2 * u);
        pts[idx].curv = lerp(pts[idx].curv || 0, jointK, w);
      }
    }

    // arclength
    let s = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      s += Math.hypot(dx, dy);
      pts[i].s = s;
    }
    return { pts, length: s, segs };
  }`;

  return text.slice(0, start) + replacement + text.slice(end);
}

function transformLegacyJs(text) {
  if (!text.startsWith("// Bordeaux — app root.")) return text;

  text = text.split("Acquitaine").join("Autonomous Routine");

  text = replaceOnce(
    text,
    "  const clone = (o) => JSON.parse(JSON.stringify(o));\n",
    "  const clone = (o) => JSON.parse(JSON.stringify(o));\n  const clampWorld = (p) => ({ x: Math.max(0, Math.min(FIELD_W, p.x)), y: Math.max(0, Math.min(FIELD_H, p.y)) });\n",
    "legacy app clamp helper",
  );

  text = replaceOnce(
    text,
    "    const [project, setProject] = useState({\n      name: 'rebuilt-2687',\n      robot: { drive: 'swerve', w: 0.84, l: 0.84, maxSpeed: 5.0 },\n      paths: [pathLeaveReef(), pathReefStation(), pathStationReef()],\n    });",
    "    const [project, setProject] = useState({\n      schemaVersion: '1.0',\n      name: 'Untitled',\n      robot: { drive: 'swerve', w: 0.84, l: 0.84, maxSpeed: 5.0 },\n      paths: [blankPath('NewPath')],\n      routine: { name: 'Autonomous Routine', nodes: [] },\n      plannerId: 'profiledSpline',\n    });",
    "legacy default project",
  );

