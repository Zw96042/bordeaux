import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const renderer = path.join(root, "public/renderer/index.html");
const html = fs.readFileSync(renderer, "utf8");
const sources = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);

if (!html.includes("Content-Security-Policy")) throw new Error("The canonical renderer must define a Content Security Policy");
if (!html.includes('<div id="root"></div>')) throw new Error("The canonical renderer is missing its root element");
if (sources.length === 0) throw new Error("The canonical renderer has no application scripts");

for (const source of sources) {
  const file = path.resolve(path.dirname(renderer), source);
  if (!file.startsWith(path.dirname(renderer) + path.sep) || !fs.existsSync(file)) throw new Error(`Missing or unsafe renderer script: ${source}`);
}

console.log(`Verified canonical renderer (${sources.length} scripts)`);
