import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (process.argv.length !== 3) {
  console.error('Usage: node scripts/build-labview-catalog.mjs <LabVIEW project directory>');
  process.exitCode = 2;
} else {
  try {
    const { buildLabviewCatalog } = require('../dist-electron/electron/labviewProject.js');
    await buildLabviewCatalog(path.resolve(process.argv[2]));
    console.log('Built bordeaux/generated/catalog-v1.json and runtime-config.template.json. Configure the compiled field identity and VI dispatch before deploying.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
