import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { notarize } from "@electron/notarize";
import { buildBlockMap } from "app-builder-lib/out/targets/blockmap/blockmap.js";

// Stapling changes the DMG bytes, so regenerate differential maps and hashes
// before the existing manifest and signature verification steps run.
export async function notarizeReleaseDmgs(directory, channel, {
  notarizeFile = notarize,
  blockMap = buildBlockMap,
  env = process.env,
} = {}) {
  if (!["beta", "latest"].includes(channel)) throw new Error("Invalid release channel");
  for (const key of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    if (!env[key]?.trim()) throw new Error(`Missing notarization credential: ${key}`);
  }
  const root = path.resolve(directory);
  const manifestPath = path.join(root, `${channel}-mac.yml`);
  const manifest = yaml.load(await fs.readFile(manifestPath, "utf8"));
  const dmgs = (await fs.readdir(root)).filter((name) => name.endsWith(".dmg"));
  if (!dmgs.length) throw new Error("No release DMGs to notarize");
  for (const name of dmgs) {
    const file = path.join(root, name);
    await notarizeFile({
      appPath: file,
      appleId: env.APPLE_ID,
      appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: env.APPLE_TEAM_ID,
    });
    const info = await blockMap(file, "gzip", `${file}.blockmap`);
    for (const entry of manifest.files ?? []) {
      if (entry.url === name) Object.assign(entry, { sha512: info.sha512, size: info.size });
    }
    if (manifest.path === name) manifest.sha512 = info.sha512;
  }
  await fs.writeFile(manifestPath, yaml.dump(manifest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await notarizeReleaseDmgs(process.argv[2] ?? "release", process.argv[3] ?? "beta");
}
