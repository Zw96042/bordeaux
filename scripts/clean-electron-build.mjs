import { rmSync } from 'node:fs';

// TypeScript leaves outputs from deleted or renamed sources behind. Rebuild the
// generated directory so removed integrations cannot enter a desktop package.
rmSync(new URL('../dist-electron/', import.meta.url), { recursive: true, force: true });
