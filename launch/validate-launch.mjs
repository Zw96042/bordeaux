for (const generatedAsset of ["assets/generated/bordeaux-brand-board.svg", "assets/generated/bordeaux-brand-board.png", "assets/generated/bordeaux-launch-key-art.png"]) {
  check(existsSync(join(launchRoot, generatedAsset)), `generated campaign asset is missing: ${generatedAsset}`);
}
const keyArtEntry = manifest.exports.find((item) => item.file === "assets/generated/bordeaux-launch-key-art.png");
check(keyArtEntry?.source === "prototypes/startup-animations/exports/spill-route.mp4", "key art must identify the reviewed Spill / Route master");
check(keyArtEntry?.sourceFrame === 78, "key art must retain the reviewed source frame");

function probeImage(relativePath, expectedWidth, expectedHeight) {
  const path = join(repoRoot, relativePath);
  const result = JSON.parse(execFileSync(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", path], { encoding: "utf8" }));
  const image = result.streams.find((stream) => stream.codec_type === "video");
  check(image?.width === expectedWidth && image?.height === expectedHeight, `${relativePath} has unexpected dimensions`);
}

function probeVideo(relativePath, expectedWidth, expectedHeight, expectedDuration) {
  const path = join(repoRoot, relativePath);
  const result = JSON.parse(execFileSync(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", path], { encoding: "utf8" }));
  const video = result.streams.find((stream) => stream.codec_type === "video");
  const audio = result.streams.find((stream) => stream.codec_type === "audio");
  check(video?.width === expectedWidth && video?.height === expectedHeight, `${relativePath} has unexpected dimensions`);
  check(Math.abs(Number(result.format.duration) - expectedDuration) < 0.05, `${relativePath} has unexpected duration ${result.format.duration}`);
  check(Boolean(audio), `${relativePath} is missing an audio stream`);
}

probeImage("launch/assets/generated/bordeaux-launch-key-art.png", 1920, 1080);
probeVideo("marketing/assets/product/bordeaux-demo.mp4", 1280, 800, 18);
probeVideo("launch/exports/bordeaux-launch-draft.mp4", 1920, 1080, 37.5);

if (failures.length) {
  console.error(`Launch validation failed (${failures.length}/${checks} checks):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Launch validation passed: ${checks} checks.`);
