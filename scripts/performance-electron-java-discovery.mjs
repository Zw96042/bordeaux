// Run after npm run build:electron. Synthetic projects exercise discovery, not Java compilation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const { discoverJavaProject } = await import(pathToFileURL(path.resolve(process.argv[2] ?? 'dist-electron/electron/javaProject.js')).href);

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bordeaux-discovery-benchmark-'));
const results = [];
try {
  for (const scenario of [
    { name: 'large-source', files: [
      `package robot;\nimport edu.wpi.first.wpilibj2.command.Command;\npublic class Factory {\n${Array.from({ length: 4000 }, (_, index) => `  public Command action${index}(double speed) { return null; }`).join('\n')}\n}`,
    ], commands: 4000 },
    { name: 'many-types', files: Array.from({ length: 100 }, (_, file) => `package robot;\nimport edu.wpi.first.wpilibj2.command.Command;\n${Array.from({ length: 60 }, (_, index) => `record Value${file}_${index}(double value) {}`).join('\n')}\npublic class Factory${file} {\n${Array.from({ length: 40 }, (_, index) => `public Command action${index}(Value99_59 known, External${index} unresolved) { return null; }`).join('\n')}\n}`), commands: 4000 },
    { name: 'many-files', files: Array.from({ length: 800 }, (_, index) => `package robot;\npublic class Helper${index} {}`), commands: 0 },
  ]) {
    const root = path.join(directory, scenario.name);
    const sources = path.join(root, 'src/main/java/robot');
    await fs.mkdir(sources, { recursive: true });
    await fs.writeFile(path.join(root, 'build.gradle'), "plugins { id 'java' }\n");
    // Bound fixture creation too, to avoid measuring resource exhaustion from setup.
    for (let start = 0; start < scenario.files.length; start += 16) {
      await Promise.all(scenario.files.slice(start, start + 16).map((source, offset) => fs.writeFile(path.join(sources, `Source${start + offset}.java`), source)));
    }
    const durations = [];
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const start = performance.now();
      const catalog = await discoverJavaProject(root);
      const duration = performance.now() - start;
      assert.equal(catalog.sourceFileCount, scenario.files.length);
      assert.equal(catalog.commands.length, scenario.commands);
      if (iteration > 0) durations.push(duration);
    }
    durations.sort((a, b) => a - b);
    results.push({ scenario: scenario.name, medianMs: Number(durations[2].toFixed(2)), minMs: Number(durations[0].toFixed(2)), files: scenario.files.length, commands: scenario.commands });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
