import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { expect, it } from "vitest";

it("loads the desktop MCP CJS entry points with only their unused ESM variants removed", async () => {
  const root = process.cwd();
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "bordeaux-mcp-package-"));
  try {
    for (const name of ["core", "server"]) {
      expect(manifest.build.files).toContain(`!node_modules/@modelcontextprotocol/${name}/**/*.mjs`);
      const source = path.join(root, "node_modules/@modelcontextprotocol", name);
      const target = path.join(temporary, "node_modules/@modelcontextprotocol", name);
      await fs.cp(source, target, { recursive: true, filter: (file) => !file.endsWith(".mjs") });
      expect(await fs.readFile(path.join(target, "LICENSE"), "utf8")).toBe(await fs.readFile(path.join(source, "LICENSE"), "utf8"));
    }
    const probe = path.join(temporary, "probe.cjs");
    await fs.writeFile(probe, `
      const assert = require('node:assert/strict');
      const { McpServer } = require('@modelcontextprotocol/server');
      const { StdioServerTransport } = require('@modelcontextprotocol/server/stdio');
      const { AjvJsonSchemaValidator } = require('@modelcontextprotocol/server/validators/ajv');
      new McpServer({ name: 'package-regression', version: '1.0.0' });
      new StdioServerTransport();
      new AjvJsonSchemaValidator();
      const loaded = Object.keys(require.cache).filter(file => file.includes('@modelcontextprotocol'));
      assert(loaded.length > 0);
      assert(loaded.every(file => file.startsWith(__dirname) && file.endsWith('.cjs')));
      require('node:fs').writeFileSync(require('node:path').join(__dirname, 'loaded.json'), JSON.stringify(loaded));
    `);
    await promisify(execFile)(process.execPath, [probe], {
      env: { ...process.env, NODE_PATH: path.join(root, "node_modules") }, encoding: "utf8",
    });
    const loaded = JSON.parse(await fs.readFile(path.join(temporary, "loaded.json"), "utf8"));
    expect(loaded.length).toBeGreaterThan(0);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
