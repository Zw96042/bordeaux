function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

assert(existsSync(manifestPath), "motion-manifest.json is missing");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assert(!("generatedAt" in manifest), "manifest must not include host-time output");
assert(manifest.generator === "render-animations.mjs", "unexpected generator");
assert(manifest.source === "render-blender.py", "unexpected Blender source");
assert(manifest.renderer.application === "Blender", "renderer must identify Blender");
assert(manifest.renderer.engine === "Eevee", "renderer must identify Eevee");
assert(manifest.renderer.samples === 64, "production render sample count changed");
assert(manifest.renderer.motionBlur.steps === 8, "motion blur step count changed");
assert(manifest.width === 1440 && manifest.height === 900, "unexpected master resolution");
assert(manifest.fps === 60, "startup masters must be 60 fps");
assert(Array.isArray(manifest.animations) && manifest.animations.length === 3, "expected three animation directions");

const expectedIds = ["spill-route", "ribbon-flight", "precision-lock"];
assert(
  manifest.animations.map((entry) => entry.id).join(",") === expectedIds.join(","),
  "manifest animation order changed"
);

for (const animation of manifest.animations) {
  assert(animation.durationSeconds >= 1.9 && animation.durationSeconds <= 3.4, `${animation.id} duration is outside the authored range`);
  assert(Boolean(animation.axis && animation.purpose && animation.cost), `${animation.id} is missing decision framing`);
  assert(animation.publicDistribution === true, `${animation.id} must use cleared public assets`);
  assert(animation.frameCount === Math.round(animation.durationSeconds * manifest.fps), `${animation.id} frame count is wrong`);
  assert(Array.isArray(animation.reviewFrameIndices) && animation.reviewFrameIndices.length === 8, `${animation.id} review sheet must select eight frames`);
  assert(animation.reviewFrameIndices[0] === 0, `${animation.id} review sheet must start at frame zero`);
  assert(animation.reviewFrameIndices.at(-1) === animation.frameCount - 1, `${animation.id} review sheet must include the final frame`);

  for (const key of ["mp4", "webm", "poster", "contactSheet"]) {
    const relative = animation[key];
    const absolute = join(here, relative);
    assert(typeof relative === "string" && existsSync(absolute), `${animation.id} is missing ${key}`);
    assert(statSync(absolute).size > 10_000, `${animation.id} ${key} is unexpectedly small`);
  }

  for (const key of ["mp4", "webm"]) {
    const info = probe(join(here, animation[key]), true);
    const video = info.streams.find((stream) => stream.codec_type === "video");
    const audio = info.streams.find((stream) => stream.codec_type === "audio");
    assert(Boolean(video), `${animation.id} ${key} has no video stream`);
    assert(!audio, `${animation.id} ${key} should be silent`);
    assert(video.width === manifest.width && video.height === manifest.height, `${animation.id} ${key} has the wrong dimensions`);
    assert(video.r_frame_rate === "60/1", `${animation.id} ${key} is not 60 fps`);
    assert(Number(video.nb_read_frames) === animation.frameCount, `${animation.id} ${key} has the wrong frame count`);
    const expectedCodec = key === "mp4" ? "h264" : "vp9";
    assert(video.codec_name === expectedCodec, `${animation.id} ${key} uses ${video.codec_name} instead of ${expectedCodec}`);
    assert(
      Math.abs(Number(info.format.duration) - animation.durationSeconds) <= 1 / manifest.fps + 0.01,
      `${animation.id} ${key} duration differs from the manifest`
    );
  }

  const poster = probe(join(here, animation.poster)).streams.find((stream) => stream.codec_type === "video");
  assert(poster.width === manifest.width && poster.height === manifest.height, `${animation.id} poster has the wrong dimensions`);
  const contact = probe(join(here, animation.contactSheet)).streams.find((stream) => stream.codec_type === "video");
  assert(contact.width === 1920 && contact.height === 600, `${animation.id} contact sheet has the wrong dimensions`);
}

const html = readFileSync(join(here, "index.html"), "utf8");
for (const label of ["Spill", "Ribbon", "Precision"]) {
  assert(html.includes(`>${label}</button>`), `picker does not label ${label}`);
}
assert(html.includes("fetch('motion-manifest.json')"), "picker does not load the motion manifest");
assert(html.includes("motion.mp4") && html.includes("motion.webm") && html.includes("motion.poster"), "picker does not use all master paths");
assert(html.includes("prefers-reduced-motion: reduce"), "picker has no reduced-motion CSS");
assert(html.includes("reducedMotion.matches"), "player has no reduced-motion playback branch");
assert(!/<video[^>]*\sloop(?:\s|=|>)/i.test(html), "startup films must not loop");
assert(!html.includes("transition: all"), "picker contains transition: all");
assert(/\.proto-picker-highlight\s*\{[\s\S]*?width:\s*76px;[\s\S]*?height:\s*44px;/.test(html), "picker highlight must match the touch-sized controls");
assert(/\.proto-picker-item\s*\{[\s\S]*?width:\s*76px;[\s\S]*?height:\s*44px;/.test(html), "picker controls must meet the 44px touch floor");
assert(html.includes("transition: transform 250ms cubic-bezier(0.23, 1, 0.32, 1)"), "picker highlight no longer uses the specified slide");
assert(!/\.proto-picker\[data-ready\] \.proto-picker-highlight\s*\{[\s\S]*?transition:[^}]*width/.test(html), "picker highlight must animate with transforms only");
assert(!html.includes("highlight.style.width"), "picker highlight changes layout width at runtime");
assert(/\.control-button\s*\{[\s\S]*?min-height:\s*44px;/.test(html), "motion inspector buttons must be touch-sized");
assert(html.includes("requestVideoFrameCallback"), "scrubber is not synchronized to presented video frames");
assert(html.includes("loadSeekableMaster"), "player does not prepare a seekable local master");
assert(html.includes("URL.createObjectURL"), "player does not recover from servers without byte ranges");
assert(html.includes("URL.revokeObjectURL"), "player leaks local master object URLs");
assert(html.includes("url.searchParams.set('v', i + 1)"), "picker does not persist selection in the URL");
assert(html.includes("playback-speed:") && html.includes("duration:") && html.includes("ease:"), "copied configuration is incomplete");

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert(inlineScripts.length === 1, "expected one inline picker script");
new Function(inlineScripts[0][1]);
checks += 1;

const wrapper = readFileSync(join(here, "render-animations.mjs"), "utf8");
assert(wrapper.includes("Promise.all(chunks.map"), "Blender frames are not rendered in parallel");
assert(wrapper.includes('"libx264"') && wrapper.includes('"libvpx-vp9"'), "master encoders are incomplete");
assert(!wrapper.includes("rsvg-convert"), "legacy SVG rasterizer remains in the render pipeline");
assert(!wrapper.includes("chap-bordeaux"), "uncleared Chap artwork remains in the render pipeline");

const blender = readFileSync(join(here, "render-blender.py"), "utf8");
for (const marker of [
  'scene.render.engine = "BLENDER_EEVEE"',
  "scene.render.use_motion_blur = True",
  "scene.eevee.motion_blur_steps = 8",
  "create_revolved_surface",
  "create_glass",
  "make_liquid_sheet",
  "set_liquid_sheet",
  "create_wine_fill",
  "set_wine_fill_surface",
  "WINE_FILL_SEGMENTS",
  "tail_progress",
  "primitive_uv_sphere_add",
  "sample_cubic",
  "gravity_ease",
  "velocities = (",
  "audit_liquid_causality",
  "tracer_position"
]) {
  assert(blender.includes(marker), `Blender source is missing ${marker}`);
}
assert(!blender.includes("SF-Pro") && !blender.includes("SFNSMono"), "Blender source still depends on Apple system fonts");
assert(!blender.includes("random."), "Blender source must not use random motion");
assert(wrapper.includes('"--audit"'), "render wrapper does not run the liquid causality gate");

const fonts = [
  ["SpaceGrotesk-Variable.ttf", "acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72"],
  ["JetBrainsMono-Variable.ttf", "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda"]
];
for (const [name, expected] of fonts) {
  const path = join(here, "assets", "fonts", name);
  assert(existsSync(path), `${name} is missing`);
  assert(sha256(path) === expected, `${name} does not match its recorded upstream hash`);
}
assert(existsSync(join(here, "assets", "fonts", "OFL.txt")), "font license is missing");

console.log(`Startup motion validation passed: ${checks} checks.`);
