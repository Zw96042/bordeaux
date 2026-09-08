import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Read-only project verification. All generated inspection/cache files go in the supplied output folder.
const require = createRequire(import.meta.url);
const { discoverLabviewProject } = require('../dist-electron/electron/labviewProject.js');
const { inspectLabviewCommands, withCachedLabviewCommands } = require('../dist-electron/electron/labviewNiInspection.js');
const [selectionArg, outputArg] = process.argv.slice(2);
assert.ok(selectionArg && outputArg, 'Usage: node scripts/verify-labview-discovery.mjs <exact.lvproj> <isolated-output-folder>');
const selection = path.resolve(selectionArg), output = path.resolve(outputArg);
assert.equal(path.extname(selection).toLowerCase(), '.lvproj');
assert.ok(output !== path.dirname(selection) && !output.startsWith(path.dirname(selection) + path.sep), 'Verification output must stay outside the reference project');
await fs.mkdir(output, { recursive: true });
const before = await fs.readFile(selection);
const disk = await discoverLabviewProject(selection);
assert.equal(disk.labviewDiscovery.projectFile, path.basename(selection));
assert.ok(disk.sourceFileCount > 0, 'Actual project must discover VI sources');
const inspected = await inspectLabviewCommands(selection, path.join(output, 'cache'));
const restored = await withCachedLabviewCommands(selection, await discoverLabviewProject(selection), path.join(output, 'cache'));
assert.deepEqual(await fs.readFile(selection), before, 'Inspection must preserve the project document');
const cacheRestored = restored.labviewDiscovery.inspection?.status === 'cached';
if (cacheRestored) assert.deepEqual(restored.commands, inspected.commands, 'Disk cache restores typed commands and identity without another NI call');
else assert.ok(inspected.labviewDiscovery.inspection?.reason, 'Live-only metadata must explain why it cannot be cached');
for (const command of inspected.commands.filter((command) => command.labviewLegacy)) {
  assert.equal(command.confidence, 'confirmed');
  assert.equal(command.runtimeReady, false, 'Inspection never authorizes native runtime execution');
  assert.ok(!command.parameters.some((parameter) => /Command Info (In|Out)/.test(parameter.name)), 'Scheduler status is not an author argument');
}
if (path.basename(selection) === 'RebuiltApprentice.lvproj') {
  const intake = inspected.commands.find((command) => command.label === 'Start Intake');
  assert.ok(intake, 'Actual Start Intake command must be identified by NI connector types');
  assert.equal(intake.parameters.find((parameter) => parameter.name === 'Setpoint')?.schema.kind, 'number');
  assert.equal(intake.parameters.find((parameter) => parameter.name === 'Description')?.schema.kind, 'string');
  assert.ok(!inspected.commands.some((command) => /_wrapper\.vi$/i.test(command.member)), 'Generated wrappers have no command connector');
}
if (path.basename(selection) === 'Trajectory.lvproj') {
  assert.equal(inspected.commands.length, 0, 'The selected planner has no RT target commands');
  assert.ok(!disk.labviewDiscovery.targets.some((target) => target.type === 'RT myRIO' || target.type === 'RT roboRIO'));
}
await fs.writeFile(path.join(output, 'catalog.json'), JSON.stringify(inspected, null, 2));
const result = { status: 'passed', projectFile: path.basename(selection), sourceFileCount: disk.sourceFileCount,
  targets: disk.labviewDiscovery.targets, commandCount: inspected.commands.length,
  commands: inspected.commands.map(({ id, label, member, parameters, runtimeReady }) => ({ id, label, member, parameters, runtimeReady })),
  cacheRestored, inspection: inspected.labviewDiscovery.inspection, warnings: inspected.warnings };
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ status: result.status, projectFile: result.projectFile, sourceFileCount: result.sourceFileCount, commandCount: result.commandCount }));
