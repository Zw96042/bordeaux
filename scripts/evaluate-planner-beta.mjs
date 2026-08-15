import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlannerBetaVerdict } from "../dist-electron/electron/benchmark/plannerBetaGate.js";

const repository = fileURLToPath(new URL("..", import.meta.url));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const plannerPath = path.resolve(repository, option("planner", ".benchmark-results/planners.json"));
const rendererPath = path.resolve(repository, option("renderer", ".benchmark-results/renderer-browser.json"));
const outputDirectory = path.resolve(repository, option("output-dir", ".benchmark-results/planner-beta"));

function digest(contents) {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents, { flag: "wx" });
  await fs.rename(temporary, file);
}

const [plannerContents, rendererContents] = await Promise.all([
  fs.readFile(plannerPath, "utf8"),
  fs.readFile(rendererPath, "utf8"),
]);
const planner = JSON.parse(plannerContents);
const renderer = JSON.parse(rendererContents);
const verdict = buildPlannerBetaVerdict(planner, renderer);
const plannerAttachment = "planner-raw.json";
const rendererAttachment = "renderer-raw.json";
const document = {
  ...verdict,
  sources: {
    planner: { attachment: plannerAttachment, sha256: digest(plannerContents) },
    renderer: { attachment: rendererAttachment, sha256: digest(rendererContents) },
  },
};

await fs.mkdir(outputDirectory, { recursive: true });
await atomicWrite(path.join(outputDirectory, plannerAttachment), plannerContents);
await atomicWrite(path.join(outputDirectory, rendererAttachment), rendererContents);
await atomicWrite(path.join(outputDirectory, "verdict.json"), `${JSON.stringify(document, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  output: path.join(outputDirectory, "verdict.json"),
  verdict: document.verdict,
  competitiveClaimsAllowed: document.competitiveClaimsAllowed,
  blockers: document.blockers,
})}\n`);
if (document.verdict !== "accept") process.exitCode = 1;
