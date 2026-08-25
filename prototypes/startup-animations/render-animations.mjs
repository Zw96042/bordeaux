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
