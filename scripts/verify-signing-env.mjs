const platform = process.argv[2];
const variables = platform === "mac"
  ? ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
  : platform === "windows"
    ? ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "WIN_SIGNER_SHA1"]
    : null;

if (!variables) throw new Error("Signing platform must be mac or windows");
const missing = variables.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Refusing to publish an unsigned ${platform} update. Configure: ${missing.join(", ")}`);
}
console.log(`Verified ${platform} release signing environment.`);
