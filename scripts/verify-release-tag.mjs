import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const argument = process.argv[2];
const isTagBuild = argument !== undefined || process.env.GITHUB_REF_TYPE === "tag";

if (!isTagBuild) {
  console.log("Not a tag build; release tag check skipped.");
} else {
  const tag = argument ?? process.env.GITHUB_REF_NAME;
  const expected = `v${manifest.version}`;
  if (tag !== expected) throw new Error(`Release tag ${tag || "<missing>"} must equal package version tag ${expected}`);
  console.log(`Verified release tag ${tag}.`);
}
