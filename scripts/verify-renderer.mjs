import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EAGER_JAVASCRIPT_BUDGET_BYTES = 700 * 1024;
const PRODUCTION_REACT_ASSETS = new Map([
  ["assets/react.production.min.js", "d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd"],
  ["assets/react-dom.production.min.js", "35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d"],
]);

const root = process.cwd();
const renderer = path.join(root, "public/renderer/index.html");
const rendererDirectory = path.dirname(renderer);
const html = fs.readFileSync(renderer, "utf8");

function tagResources(tagName, attribute) {
  const tags = [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((match) => match[0]);
  return tags.flatMap((tag) => {
    const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"));
    return match ? [match[2]] : [];
  });
}

function resolveRendererResource(resource) {
  if (/^[a-z][a-z\d+.-]*:/i.test(resource) || resource.startsWith("//") || /[?#]/.test(resource)) {
    throw new Error(`Renderer resources must be local files without query strings: ${resource}`);
  }
  const file = path.resolve(rendererDirectory, resource);
  const relative = path.relative(rendererDirectory, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Missing or unsafe renderer resource: ${resource}`);
  }
  return file;
}

const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
const sources = tagResources("script", "src");
const stylesheets = [...html.matchAll(/<link\b[^>]*>/gi)]
  .map((match) => match[0])
  .filter((tag) => /\brel\s*=\s*(["'])stylesheet\1/i.test(tag))
  .flatMap((tag) => {
    const match = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    return match ? [match[2]] : [];
  });

if (!html.includes("Content-Security-Policy")) throw new Error("The canonical renderer must define a Content Security Policy");
if (!html.includes('<div id="root"></div>')) throw new Error("The canonical renderer is missing its root element");
if (/<style\b/i.test(html) || scriptTags.some((tag) => !/\bsrc\s*=/i.test(tag))) {
  throw new Error("Renderer code and styles must stay outside index.html");
}
if (sources.length === 0) throw new Error("The canonical renderer has no application scripts");
if (stylesheets.length === 0) throw new Error("The canonical renderer has no stylesheet");
if (new Set([...stylesheets, ...sources]).size !== stylesheets.length + sources.length) {
  throw new Error("The canonical renderer loads the same resource more than once");
}

const developmentReact = sources.find((source) => /react(?:-dom)?\.development(?:\.min)?\.js$/i.test(source));
if (developmentReact) throw new Error(`Development React must not ship in the renderer: ${developmentReact}`);

const resolvedSources = new Map();
for (const resource of [...stylesheets, ...sources]) {
  const file = resolveRendererResource(resource);
  if (sources.includes(resource)) resolvedSources.set(resource, file);
}

for (const [resource, expectedHash] of PRODUCTION_REACT_ASSETS) {
  const file = resolvedSources.get(resource);
  if (!file) throw new Error(`The canonical renderer must load React 18.3.1 production asset: ${resource}`);
  const contents = fs.readFileSync(file);
  const actualHash = createHash("sha256").update(contents).digest("hex");
  if (actualHash !== expectedHash) throw new Error(`Vendored React asset has unexpected contents: ${resource}`);
}

const eagerJavaScriptBytes = [...resolvedSources.values()]
  .reduce((total, file) => total + fs.statSync(file).size, 0);
if (eagerJavaScriptBytes > EAGER_JAVASCRIPT_BUDGET_BYTES) {
  throw new Error(`Renderer eager JavaScript is ${eagerJavaScriptBytes.toLocaleString()} bytes; budget is ${EAGER_JAVASCRIPT_BUDGET_BYTES.toLocaleString()} bytes`);
}

console.log(`Verified canonical renderer (${stylesheets.length} stylesheet, ${sources.length} scripts, ${eagerJavaScriptBytes.toLocaleString()} eager JavaScript bytes)`);
