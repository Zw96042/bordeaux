    width: options.width,
    height: options.height
  })) {
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`--${name} must be a positive integer`);
    }
  }
  if (options.framesDir && options.film === "all") {
    throw new Error("--frames-dir requires a single --film");
  }
  if (options.film !== "all" && !films.some((film) => film.id === options.film)) {
    throw new Error(`Unknown film: ${options.film}`);
  }
  return options;
}

function findBlender() {
  const candidates = [
    process.env.BLENDER_BIN,
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "/Volumes/Blender/Blender.app/Contents/MacOS/Blender",
    "blender"
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === "blender" || existsSync(candidate));
}

function run(binary, args, { quiet = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binary, args, {
      cwd: here,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let output = "";
    if (quiet) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
    }
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(`${binary} exited with ${signal || code}${output ? `\n${output}` : ""}`));
    });
  });
}

function splitFrames(frameCount, jobCount) {
  const chunks = [];
  const size = Math.ceil(frameCount / Math.min(frameCount, jobCount));
  for (let start = 1; start <= frameCount; start += size) {
    chunks.push([start, Math.min(frameCount, start + size - 1)]);
  }
  return chunks;
}

function assertFrames(frameDirectory, film) {
  const pattern = new RegExp(`^${film.id}-\\d{4}\\.png$`);
  const names = new Set(readdirSync(frameDirectory).filter((name) => pattern.test(name)));
  const missing = [];
  for (let frame = 1; frame <= film.frames; frame += 1) {
    const name = `${film.id}-${String(frame).padStart(4, "0")}.png`;
    if (!names.has(name)) missing.push(frame);
  }
  if (missing.length || names.size !== film.frames) {
    const detail = missing.length ? `; missing ${missing.slice(0, 8).join(", ")}` : "";
    throw new Error(`${film.id}: expected frames 1–${film.frames}, found ${names.size}${detail}`);
  }
}

async function renderFrames(blender, film, options, frameDirectory) {
  const prefix = join(frameDirectory, `${film.id}-`);
  const chunks = splitFrames(film.frames, options.jobs);
  if (film.id !== "precision-lock") {
    console.log(`${film.id}: auditing lip attachment and world-space flow`);
    await run(blender, [
      "--background",
      "--factory-startup",
      "--python", blenderSource,
      "--",
      "--film", film.id,
      "--frame", "1",
      "--output", join(frameDirectory, `${film.id}-audit.png`),
      "--width", "320",
      "--height", "200",
      "--samples", "1",
      "--preview",
      "--audit"
    ], { quiet: true });
  }
  console.log(`${film.id}: rendering ${film.frames} frames across ${chunks.length} Blender workers`);
  await Promise.all(chunks.map(([start, end]) => run(blender, [
    "--background",
    "--factory-startup",
    "--python", blenderSource,
    "--",
    "--film", film.id,
    "--animation",
    "--frame-start", String(start),
    "--frame-end", String(end),
    "--output", prefix,
    "--width", String(options.width),
    "--height", String(options.height),
    "--samples", String(options.samples)
  ])));
}

async function encodeFilm(ffmpeg, film, options, frameDirectory) {
  assertFrames(frameDirectory, film);
  const input = join(frameDirectory, `${film.id}-%04d.png`);
  const mp4 = join(exportDir, `${film.id}.mp4`);
  const webm = join(exportDir, `${film.id}.webm`);
  const poster = join(exportDir, `${film.id}-poster.png`);
  const contactSheet = join(reviewDir, `${film.id}-contact-sheet.png`);
  const color = [
    "-colorspace", "bt709",
    "-color_primaries", "bt709",
    "-color_trc", "bt709"
  ];

  console.log(`${film.id}: encoding H.264 master`);
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "warning", "-y",
    "-framerate", "60", "-start_number", "1", "-i", input,
    "-frames:v", String(film.frames),
    "-c:v", "libx264", "-preset", "slow", "-crf", "16",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ...color,
    mp4
  ]);

  console.log(`${film.id}: encoding VP9 master`);
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "warning", "-y",
    "-framerate", "60", "-start_number", "1", "-i", input,
    "-frames:v", String(film.frames),
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24",
    "-deadline", "good", "-cpu-used", "2", "-row-mt", "1",
    "-pix_fmt", "yuv420p",
    ...color,
    webm
  ]);

  copyFileSync(join(frameDirectory, `${film.id}-${String(film.frames).padStart(4, "0")}.png`), poster);

  const frames = Array.from({ length: 8 }, (_, index) =>
    Math.round(index * (film.frames - 1) / 7)
  );
  const selection = frames.map((frame) => `eq(n\\,${frame})`).join("+");
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "warning", "-y",
    "-framerate", "60", "-start_number", "1", "-i", input,
    "-vf", `select='${selection}',scale=480:-2,tile=4x2`,
    "-frames:v", "1", "-update", "1", contactSheet
  ]);

  console.log(`${film.id}: wrote MP4, WebM, poster, and contact sheet`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const selectedFilms = options.film === "all"
    ? films
    : films.filter((film) => film.id === options.film);
  const blender = options.framesDir ? null : findBlender();
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
  if (!options.framesDir && !blender) {
    throw new Error("Blender was not found. Install Blender or set BLENDER_BIN.");
  }

  mkdirSync(exportDir, { recursive: true });
  mkdirSync(reviewDir, { recursive: true });

  for (const film of selectedFilms) {
    const generatedRoot = options.framesDir
      ? null
      : mkdtempSync(join(tmpdir(), `bordeaux-${film.id}-`));
    const frameDirectory = options.framesDir || generatedRoot;
    try {
      if (!options.framesDir) await renderFrames(blender, film, options, frameDirectory);
      await encodeFilm(ffmpeg, film, options, frameDirectory);
      if (generatedRoot && options.keepFrames) {
        console.log(`${film.id}: frames preserved at ${generatedRoot}`);
      }
    } finally {
      if (generatedRoot && !options.keepFrames) {
        rmSync(generatedRoot, { recursive: true, force: true });
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
