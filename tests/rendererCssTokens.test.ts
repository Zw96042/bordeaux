import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../src/renderer");
const read = (dir: string, extensions: string[]) => fs.readdirSync(path.join(root, dir))
  .filter((name) => extensions.some((extension) => name.endsWith(extension)))
  .map((name) => ({ name: dir + "/" + name, text: fs.readFileSync(path.join(root, dir, name), "utf8") }));

describe("renderer style tokens", () => {
  it("defines every custom property used without a fallback", () => {
    const styles = read("styles", [".css"]);
    const scripts = [...read("components", [".jsx", ".js"]), ...read("app", [".jsx"])];
    const defined = new Set<string>();
    for (const { text } of styles) for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1]);
    // Components set layout variables such as --library-ratio inline.
    for (const { text } of scripts) for (const match of text.matchAll(/['"](--[\w-]+)['"]\s*:/g)) defined.add(match[1]);

    const missing: string[] = [];
    for (const { name, text } of [...styles, ...scripts]) {
      for (const match of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
        if (match[2] === ")" && !defined.has(match[1])) missing.push(name + " " + match[1]);
      }
    }
    expect(missing).toEqual([]);
  });
});
