import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import yaml from "js-yaml";
import { expect, it } from "vitest";
import { notarizeReleaseDmgs } from "../scripts/notarize-release-dmgs.mjs";

const env = { APPLE_ID: "test", APPLE_APP_SPECIFIC_PASSWORD: "test", APPLE_TEAM_ID: "test" };
it("refreshes DMG hashes and blockmaps after stapling without altering ZIP entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bordeaux-dmg-test-"));
  try {
    await writeFile(path.join(root, "app.dmg"), "signed image");
    const zip = { url: "app.zip", sha512: "zip-hash", size: 10 };
    await writeFile(path.join(root, "beta-mac.yml"), yaml.dump({
      version: "1.0", path: "app.zip", sha512: "zip-hash",
      files: [zip, { url: "app.dmg", sha512: "old", size: 12 }],
    }));
    await notarizeReleaseDmgs(root, "beta", { env, notarizeFile: async ({ appPath }) => {
      await writeFile(appPath, "signed image with stapled ticket");
    } });
    const manifest = yaml.load(await readFile(path.join(root, "beta-mac.yml"), "utf8"));
    const bytes = await readFile(path.join(root, "app.dmg"));
    expect(manifest.files[0]).toEqual(zip);
    expect(manifest.sha512).toBe("zip-hash");
    expect(manifest.files[1]).toEqual({ url: "app.dmg", size: bytes.length,
      sha512: createHash("sha512").update(bytes).digest("base64") });
    expect((await readFile(path.join(root, "app.dmg.blockmap"))).length).toBeGreaterThan(0);
    const original = await readFile(path.join(root, "beta-mac.yml"), "utf8");
    await expect(notarizeReleaseDmgs(root, "beta", { env, notarizeFile: async () => {
      throw new Error("Apple rejected submission");
    } })).rejects.toThrow("Apple rejected submission");
    expect(await readFile(path.join(root, "beta-mac.yml"), "utf8")).toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
