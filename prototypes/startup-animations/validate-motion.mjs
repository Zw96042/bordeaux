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
