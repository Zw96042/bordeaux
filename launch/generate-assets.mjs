import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launchRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(launchRoot);
const renderer = process.env.RSVG_CONVERT_BIN || "rsvg-convert";
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const exports = [];
const canonicalGlassSource = "build/icon-assets/wine-glass.svg";
const canonicalGlassData = Buffer.from(readFileSync(join(repoRoot, canonicalGlassSource), "utf8")).toString("base64");

const palette = {
  ink: "#0a0a0b",
  inkRaised: "#141317",
  ivory: "#f5efe6",
  muted: "#aaa4a0",
  wine: "#b95770",
  wineBright: "#c9677e",
  wineDeep: "#702238",
  blue: "#7ea2ed",
  green: "#77c795",
  line: "#2b292e",
};

function defs() {
  return `<defs>
    <linearGradient id="wine" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${palette.wine}"/><stop offset="1" stop-color="${palette.wineDeep}"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f5efe6" stop-opacity=".16"/><stop offset="1" stop-color="#c8c1bc" stop-opacity=".04"/></linearGradient>
    <radialGradient id="wineGlow"><stop stop-color="${palette.wine}" stop-opacity=".38"/><stop offset="1" stop-color="${palette.wine}" stop-opacity="0"/></radialGradient>
    <radialGradient id="blueGlow"><stop stop-color="${palette.blue}" stop-opacity=".2"/><stop offset="1" stop-color="${palette.blue}" stop-opacity="0"/></radialGradient>
    <linearGradient id="pathGradient" x1="0" x2="1"><stop stop-color="${palette.blue}"/><stop offset=".48" stop-color="${palette.wineBright}"/><stop offset="1" stop-color="${palette.blue}"/></linearGradient>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0V52" fill="none" stroke="#fff" stroke-opacity=".045"/></pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000" flood-opacity=".42"/></filter>
  </defs>`;
}

function svg(width, height, content, { background = null, label = "Bordeaux launch asset", includeDefs = true } = {}) {
  const backgroundRect = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">${includeDefs ? defs() : ""}${backgroundRect}${content}</svg>`;
}

function glass(x, y, size, { light = false, monochrome = false } = {}) {
  if (!light && !monochrome) {
    return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${canonicalGlassData}"/>`;
  }

  const stroke = "#171319";
  if (monochrome) {
    return `<g transform="translate(${x} ${y}) scale(${size / 1024})">
      <path d="M286 216C299 432 365 558 512 582C659 558 725 432 738 216Z" fill="none" stroke="${stroke}" stroke-width="22" stroke-linejoin="round"/>
      <path d="M332 374C430 347 594 347 692 374C675 492 616 556 512 574C408 556 349 492 332 374Z" fill="${stroke}"/>
      <ellipse cx="512" cy="216" rx="226" ry="31" fill="none" stroke="${stroke}" stroke-width="22"/>
      <path d="M512 582V755" fill="none" stroke="${stroke}" stroke-width="24" stroke-linecap="round"/>
      <path d="M350 817C402 779 459 762 512 762C565 762 622 779 674 817Z" fill="none" stroke="${stroke}" stroke-width="22" stroke-linejoin="round"/>
    </g>`;
  }

  return `<g transform="translate(${x} ${y}) scale(${size / 1024})">
    <path d="M286 216C299 432 365 558 512 582C659 558 725 432 738 216Z" fill="#171319" fill-opacity=".05" stroke="${stroke}" stroke-width="22" stroke-linejoin="round"/>
    <path d="M332 374C430 347 594 347 692 374C675 492 616 556 512 574C408 556 349 492 332 374Z" fill="url(#wine)"/>
    <path d="M332 374C430 347 594 347 692 374C594 402 430 402 332 374Z" fill="${palette.wineBright}"/>
    <ellipse cx="512" cy="216" rx="226" ry="31" fill="#fff" fill-opacity=".72" stroke="${stroke}" stroke-width="22"/>
    <path d="M337 259C350 352 372 422 413 481" fill="none" stroke="${stroke}" stroke-opacity=".26" stroke-width="20" stroke-linecap="round"/>
    <path d="M512 582V755" fill="none" stroke="${stroke}" stroke-width="24" stroke-linecap="round"/>
    <path d="M350 817C402 779 459 762 512 762C565 762 622 779 674 817Z" fill="none" stroke="${stroke}" stroke-width="22" stroke-linejoin="round"/>
  </g>`;
}

function eyebrow(x, y, text, anchor = "start", color = palette.muted) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="3.6">${text.toUpperCase()}</text>`;
}

function title(x, y, lines, { size = 92, anchor = "start", color = palette.ivory, lineHeight = 0.95 } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="Georgia, serif" font-size="${size}" font-weight="500" letter-spacing="-${Math.round(size * 0.045)}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * lineHeight : 0}">${line}</tspan>`).join("")}</text>`;
}

function body(x, y, lines, { size = 28, anchor = "start", color = palette.muted, lineHeight = 1.45 } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="400">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * lineHeight : 0}">${line}</tspan>`).join("")}</text>`;
}

function route(x, y, width, height, { dots = true, strokeWidth = 7 } = {}) {
  const startX = x;
  const startY = y + height * 0.75;
  const midX = x + width * 0.5;
  const midY = y + height * 0.35;
  const endX = x + width;
  const endY = y + height * 0.15;
  const d = `M${startX} ${startY}C${x + width * 0.25} ${y + height},${x + width * 0.25} ${y},${midX} ${midY}S${x + width * 0.75} ${y + height},${endX} ${endY}`;
  return `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="${strokeWidth * 3}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#pathGradient)" stroke-width="${strokeWidth}" stroke-linecap="round"/>${dots ? `<g fill="${palette.inkRaised}" stroke-width="${Math.max(3, strokeWidth * 0.55)}"><circle cx="${startX}" cy="${startY}" r="${strokeWidth * 1.6}" stroke="${palette.blue}"/><circle cx="${midX}" cy="${midY}" r="${strokeWidth * 1.6}" stroke="${palette.wineBright}"/><circle cx="${endX}" cy="${endY}" r="${strokeWidth * 1.6}" stroke="${palette.blue}"/></g>` : ""}`;
}

function brandLine(x, y, { size = 54, anchor = "start", color = palette.ivory } = {}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}" font-weight="650" letter-spacing="-${Math.round(size * .03)}">Bordeaux</text>`;
}

function render(relativePath, source, width, height, png = true) {
  const svgPath = join(launchRoot, relativePath);
  mkdirSync(dirname(svgPath), { recursive: true });
  writeFileSync(svgPath, source);
  exports.push({ file: relativePath, width, height, format: "SVG" });

  if (png) {
    const pngPath = svgPath.replace(/\.svg$/, ".png");
    execFileSync(renderer, ["-w", String(width), "-h", String(height), "-o", pngPath, svgPath]);
    exports.push({ file: relativePath.replace(/\.svg$/, ".png"), width, height, format: "PNG" });
  }
}

function editorialBackground(width, height) {
  return `<circle cx="${width * .78}" cy="${height * .2}" r="${Math.min(width, height) * .52}" fill="url(#wineGlow)"/><circle cx="${width * .62}" cy="${height * .8}" r="${Math.min(width, height) * .38}" fill="url(#blueGlow)"/><rect width="${width}" height="${height}" fill="url(#grid)" opacity=".36"/>`;
}

function brandBoard() {
  const panelLabel = (number, label, x, y) => `<text x="${x}" y="${y}" fill="${palette.muted}" font-family="monospace" font-size="15" font-weight="600" letter-spacing="2.4"><tspan fill="${palette.ivory}">${number}</tspan><tspan dx="14">${label.toUpperCase()}</tspan></text>`;
  const swatch = (x, color, name, value, darkText = false) => `<g transform="translate(${x} 564)"><rect width="128" height="214" fill="${color}"/><text x="14" y="158" fill="${darkText ? palette.ink : palette.ivory}" font-family="monospace" font-size="13" font-weight="700">${name}</text><text x="14" y="184" fill="${darkText ? palette.ink : palette.ivory}" fill-opacity=".72" font-family="monospace" font-size="12">${value}</text></g>`;
  const uiCard = (x, y, width, label, value, accent) => `<g transform="translate(${x} ${y})"><rect width="${width}" height="72" rx="10" fill="#1b1b20" stroke="${palette.line}"/><circle cx="34" cy="36" r="10" fill="${accent}"/><text x="60" y="29" fill="${palette.muted}" font-family="monospace" font-size="11" letter-spacing="1.6">${label}</text><text x="60" y="52" fill="${palette.ivory}" font-family="Arial, sans-serif" font-size="17" font-weight="600">${value}</text></g>`;

  return svg(2400, 1350, `
    ${editorialBackground(2400, 1350)}
    <g stroke="#fff" stroke-opacity=".16"><path d="M800 0v1350M1600 0v1350M0 450h2400M0 900h2400"/></g>

    <g>
      <circle cx="236" cy="198" r="190" fill="url(#wineGlow)"/>
      ${glass(66, 38, 330)}
      ${title(400, 198, ["Bordeaux"], { size: 78 })}
      ${body(404, 246, ["Draw the path. Know the run."], { size: 20, color: palette.wineBright })}
      ${panelLabel("01", "Hero mark", 38, 414)}
    </g>

    <g>
      ${glass(845, 82, 240)}
      ${title(1070, 208, ["Bordeaux"], { size: 72 })}
      ${eyebrow(1074, 252, "FRC trajectory authoring", "start", palette.wineBright)}
      <path d="M1072 292h370" stroke="${palette.line}"/>
      ${body(1074, 333, ["Plan  ·  Compose  ·  Review"], { size: 17, color: palette.ivory })}
      ${panelLabel("02", "Primary lockup", 838, 414)}
    </g>

    <g>
      <rect x="1638" y="34" width="724" height="332" rx="14" fill="#0e0f12" stroke="${palette.line}"/>
      <rect x="1638" y="34" width="724" height="332" rx="14" fill="url(#grid)" opacity=".55"/>
      ${route(1694, 90, 612, 230, { strokeWidth: 7 })}
      ${panelLabel("03", "Path and waypoint motif", 1638, 414)}
    </g>

    <g>
      <rect x="70" y="500" width="292" height="292" rx="72" fill="#19191d" stroke="#fff" stroke-opacity=".13" stroke-width="4"/>
      <circle cx="216" cy="646" r="150" fill="url(#wineGlow)"/>
      ${glass(68, 497, 296)}
      ${title(404, 632, ["Bordeaux"], { size: 58 })}
      ${body(408, 679, ["Desktop app icon", "and product signature"], { size: 18 })}
      ${panelLabel("04", "App icon", 38, 864)}
    </g>

    <g>
      <rect x="838" y="500" width="724" height="320" rx="14" fill="#0e0f12" stroke="${palette.line}"/>
      <rect x="838" y="500" width="724" height="50" rx="14" fill="#19191d"/>
      ${eyebrow(864, 532, "Plan · Compose · Review", "start", palette.wineBright)}
      ${uiCard(864, 578, 284, "WAYPOINT", "WP-04 · 2.10 m", palette.blue)}
      ${uiCard(864, 666, 284, "CONSTRAINT", "Max velocity · 3.5 m/s", palette.wineBright)}
      <rect x="1172" y="578" width="362" height="160" rx="10" fill="#111318" stroke="${palette.line}"/>
      ${route(1204, 600, 298, 112, { strokeWidth: 4 })}
      <rect x="1172" y="754" width="174" height="42" rx="9" fill="${palette.ivory}"/><text x="1259" y="780" text-anchor="middle" fill="${palette.ink}" font-family="Arial, sans-serif" font-size="13" font-weight="700">APPLY</text>
      <rect x="1360" y="754" width="174" height="42" rx="9" fill="#19191d" stroke="${palette.line}"/><text x="1447" y="780" text-anchor="middle" fill="${palette.ivory}" font-family="Arial, sans-serif" font-size="13" font-weight="700">REJECT</text>
      ${panelLabel("05", "Product material language", 838, 864)}
    </g>

    <g>
      <rect x="1638" y="500" width="724" height="320" rx="14" fill="#0e0f12" stroke="${palette.line}"/>
      ${swatch(1680, palette.inkRaised, "GRAPHITE", "#141317")}
      ${swatch(1808, palette.ivory, "WARM IVORY", "#F5EFE6", true)}
      ${swatch(1936, palette.wine, "BORDEAUX", "#B95770")}
      ${swatch(2064, palette.wineDeep, "WINE DEEP", "#702238")}
      ${swatch(2192, palette.blue, "PATH", "#7EA2ED", true)}
      ${panelLabel("06", "Color palette", 1638, 864)}
    </g>

    <g>
      ${title(52, 1010, ["Bordeaux"], { size: 70 })}
      ${title(52, 1088, ["Draw the path."], { size: 46, color: palette.wineBright })}
      ${title(52, 1142, ["Know the run."], { size: 46, color: palette.wineBright })}
      ${body(478, 1008, ["DISPLAY", "Georgia Medium"], { size: 14, color: palette.muted })}
      ${body(478, 1092, ["INTERFACE", "Space Grotesk Semibold"], { size: 14, color: palette.muted })}
      <text x="478" y="1190" fill="${palette.blue}" font-family="monospace" font-size="15">FRC TRAJECTORY AUTHORING</text>
      <text x="52" y="1245" fill="${palette.ivory}" font-family="Arial, sans-serif" font-size="20" letter-spacing="5">PLAN  ·  COMPOSE  ·  REVIEW</text>
      ${panelLabel("07", "Typographic hierarchy", 38, 1314)}
    </g>

    <g>
      <circle cx="1410" cy="1060" r="185" fill="url(#wineGlow)"/>
      ${title(846, 1032, ["Draw the path.", "Know the run."], { size: 58 })}
      ${eyebrow(850, 1174, "FRC trajectory authoring", "start", palette.blue)}
      ${glass(1280, 930, 300)}
      ${panelLabel("08", "Campaign crop", 838, 1314)}
    </g>

    <g>
      <g transform="rotate(28 1808 1064)">${glass(1636, 894, 344)}</g>
      <path d="M1925 1018C1995 1060 2020 1130 2085 1108C2160 1082 2192 1180 2298 1168" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="24" stroke-linecap="round"/>
      <path d="M1925 1018C1995 1060 2020 1130 2085 1108C2160 1082 2192 1180 2298 1168" fill="none" stroke="url(#pathGradient)" stroke-width="8" stroke-linecap="round"/>
      <g fill="${palette.inkRaised}" stroke-width="4"><circle cx="2085" cy="1108" r="14" stroke="${palette.wineBright}"/><circle cx="2298" cy="1168" r="14" stroke="${palette.blue}"/></g>
      ${body(1650, 1254, ["Impact becomes a legible route."], { size: 18, color: palette.ivory })}
      ${panelLabel("09", "Motion principle", 1638, 1314)}
    </g>
  `, { background: palette.ink, label: "Bordeaux deterministic brand system board" });
}

render("assets/brand/wordmark-on-dark.svg", svg(1600, 400, `${glass(40, -5, 410)}${brandLine(435, 254, { size: 164 })}`, { label: "Bordeaux horizontal wordmark for dark backgrounds" }), 1600, 400);
render("assets/brand/wordmark-on-light.svg", svg(1600, 400, `${glass(40, -5, 410, { light: true })}${brandLine(435, 254, { size: 164, color: "#171319" })}`, { label: "Bordeaux horizontal wordmark for light backgrounds" }), 1600, 400);
render("assets/brand/stacked-lockup.svg", svg(1200, 1200, `<circle cx="600" cy="390" r="410" fill="url(#wineGlow)"/>${glass(300, 80, 600)}${brandLine(600, 900, { size: 118, anchor: "middle" })}${eyebrow(600, 965, "FRC trajectory authoring", "middle")}`, { background: palette.ink, label: "Bordeaux stacked wine glass logo" }), 1200, 1200);
render("assets/brand/mark-monochrome.svg", svg(1024, 1024, glass(0, 0, 1024, { monochrome: true }), { label: "Monochrome Bordeaux wine glass mark", includeDefs: false }), 1024, 1024);
render("assets/generated/bordeaux-brand-board.svg", brandBoard(), 2400, 1350);

const og = svg(1200, 630, `${editorialBackground(1200, 630)}${eyebrow(74, 84, "Bordeaux · FRC trajectory authoring")}${title(74, 208, ["Draw the path.", "Know the run."], { size: 86 })}${body(78, 418, ["Paths, routines, constraints, and typed Java events", "in one focused desktop editor."], { size: 24 })}${glass(822, 35, 360)}${route(741, 396, 365, 155, { strokeWidth: 6 })}`, { background: palette.ink, label: "Bordeaux social preview" });
render("assets/social/og-1200x630.svg", og, 1200, 630);
render("../marketing/assets/social/bordeaux-og.svg", og, 1200, 630);

render("assets/social/square-1080x1080.svg", svg(1080, 1080, `${editorialBackground(1080, 1080)}${eyebrow(70, 86, "Introducing Bordeaux")}${title(70, 255, ["Draw the", "path. Know", "the run."], { size: 112 })}${glass(610, 468, 390)}${route(96, 822, 820, 150, { strokeWidth: 7 })}${body(74, 1010, ["A focused desktop editor for FRC autonomous."], { size: 24 })}`, { background: palette.ink, label: "Square Bordeaux launch announcement" }), 1080, 1080);

render("assets/social/story-1080x1920.svg", svg(1080, 1920, `${editorialBackground(1080, 1920)}${eyebrow(72, 270, "Bordeaux · Beta")}${title(72, 455, ["Draw", "the path.", "Know", "the run."], { size: 142, lineHeight: .91 })}${route(94, 930, 850, 350, { strokeWidth: 9 })}${glass(320, 1050, 440)}${body(74, 1570, ["FRC paths, routines, constraints,", "and typed Java events."], { size: 30 })}${brandLine(74, 1700, { size: 38 })}`, { background: palette.ink, label: "Vertical Bordeaux launch story" }), 1080, 1920);

render("assets/social/youtube-thumbnail-1280x720.svg", svg(1280, 720, `${editorialBackground(1280, 720)}${eyebrow(70, 82, "Build season, made legible")}${title(70, 232, ["Meet Bordeaux"], { size: 112 })}${body(76, 302, ["The FRC autonomous path + routine editor"], { size: 28, color: palette.ivory })}<rect x="72" y="368" width="460" height="212" rx="16" fill="#111318" stroke="${palette.line}"/>${route(114, 392, 365, 150, { strokeWidth: 6 })}${glass(820, 30, 410)}<rect x="72" y="620" width="198" height="48" rx="12" fill="${palette.ivory}"/><text x="171" y="651" text-anchor="middle" fill="${palette.ink}" font-family="Arial, sans-serif" font-size="15" font-weight="700">WATCH THE DEMO</text>`, { background: palette.ink, label: "Bordeaux launch video thumbnail" }), 1280, 720);

function featureCard(kind) {
  if (kind === "paths") {
    return { eyebrow: "01 · Plan", headline: ["Shape motion with", "constraints in view."], visual: `<rect x="730" y="120" width="750" height="660" rx="18" fill="#111318" stroke="${palette.line}"/><rect x="730" y="120" width="750" height="660" rx="18" fill="url(#grid)"/>${route(820, 220, 560, 420, { strokeWidth: 8 })}<g font-family="monospace" font-size="16"><text x="810" y="730" fill="${palette.muted}">MAX V</text><text x="886" y="730" fill="${palette.ivory}">4.20 m/s</text><text x="1050" y="730" fill="${palette.muted}">TIME</text><text x="1112" y="730" fill="${palette.ivory}">2.84 s</text></g>` };
  }
  if (kind === "routines") {
    const step = (y, label, name, accent) => `<rect x="770" y="${y}" width="650" height="116" rx="14" fill="#1b1b20" stroke="${palette.line}"/><rect x="794" y="${y + 24}" width="68" height="68" rx="12" fill="${accent}" fill-opacity=".17"/><text x="828" y="${y + 68}" text-anchor="middle" fill="${accent}" font-family="Arial" font-size="26">${label === "PATH" ? "↗" : label === "COMMAND" ? "⌁" : "◇"}</text><text x="890" y="${y + 43}" fill="${palette.muted}" font-family="monospace" font-size="13" letter-spacing="2">${label}</text><text x="890" y="${y + 78}" fill="${palette.ivory}" font-family="Arial" font-size="23" font-weight="600">${name}</text>`;
    return { eyebrow: "02 · Aquitaine", headline: ["Compose the run,", "not another file."], visual: `${step(122, "PATH", "Leave starting zone", palette.blue)}<path d="M828 238v36" stroke="${palette.line}" stroke-width="3"/>${step(274, "COMMAND", "Score preload", palette.wineBright)}<path d="M828 390v36" stroke="${palette.line}" stroke-width="3"/>${step(426, "DECISION", "Game piece present?", palette.green)}<rect x="770" y="570" width="310" height="64" rx="10" fill="#121216"/><rect x="1110" y="570" width="310" height="64" rx="10" fill="#121216"/><text x="797" y="610" fill="${palette.muted}" font-family="Arial" font-size="17">Yes → Collect center</text><text x="1137" y="610" fill="${palette.muted}" font-family="Arial" font-size="17">No → Park safely</text>` };
  }
  return { eyebrow: "03 · Java", headline: ["Typed events.", "Reviewable", "handoff."], visual: `<rect x="720" y="110" width="770" height="680" rx="18" fill="#0e0f12" stroke="${palette.line}"/><rect x="720" y="110" width="770" height="58" rx="18" fill="#191a1f"/><text x="750" y="146" fill="${palette.muted}" font-family="monospace" font-size="15">ExampleCommands.java</text><text x="770" y="232" fill="#b8c8f4" font-family="monospace" font-size="19">@BordeauxCommand(</text><text x="808" y="271" fill="${palette.muted}" font-family="monospace" font-size="19">id = <tspan fill="#d694a5">&quot;intake.hold&quot;</tspan>,</text><text x="808" y="310" fill="${palette.muted}" font-family="monospace" font-size="19">label = <tspan fill="#d694a5">&quot;Hold intake&quot;</tspan>)</text><text x="770" y="370" fill="#c8cae9" font-family="monospace" font-size="19">public Command hold(double output) {</text><text x="808" y="417" fill="${palette.muted}" font-family="monospace" font-size="19">return Commands.startEnd(</text><text x="846" y="456" fill="#d694a5" font-family="monospace" font-size="19">() -&gt; intake.set(output),</text><text x="846" y="495" fill="#d694a5" font-family="monospace" font-size="19">intake::stop, intake);</text><text x="770" y="534" fill="#c8cae9" font-family="monospace" font-size="19">}</text><path d="M770 607h650" stroke="${palette.line}"/><circle cx="786" cy="668" r="11" fill="${palette.green}"/><text x="814" y="675" fill="${palette.ivory}" font-family="Arial" font-size="20" font-weight="600">Catalog validated before export</text>` };
}

for (const kind of ["paths", "routines", "java"]) {
  const card = featureCard(kind);
  render(`assets/product/feature-${kind}-1600x900.svg`, svg(1600, 900, `${editorialBackground(1600, 900)}${eyebrow(72, 90, card.eyebrow)}${title(72, 246, card.headline, { size: kind === "java" ? 72 : 84 })}${body(78, 494, kind === "paths" ? ["Waypoints, headings, local constraint ranges,", "and timeline playback on one field."] : kind === "routines" ? ["Paths, commands, waits, and decisions in", "a complete autonomous sequence."] : ["Managed support, deterministic catalogs,", "and a contract the robot can verify."], { size: 25 })}${card.visual}`, { background: palette.ink, label: `Bordeaux ${kind} feature card` }), 1600, 900);
}

function videoCard(name, eyebrowText, heading, subheading, visual = "route") {
  const visualContent = visual === "glass" ? glass(1260, 95, 560) : `${route(995, 250, 730, 470, { strokeWidth: 10 })}${glass(1345, 148, 330)}`;
  return svg(1920, 1080, `${editorialBackground(1920, 1080)}${eyebrow(106, 130, eyebrowText)}${title(106, 368, heading, { size: 126 })}${body(114, 690, subheading, { size: 31 })}${visualContent}${brandLine(108, 972, { size: 32 })}${eyebrow(1810, 970, "Beta", "end", palette.ivory)}`, { background: palette.ink, label: name });
}

render("assets/video/title-card-1920x1080.svg", videoCard("Bordeaux launch title card", "Introducing Bordeaux", ["Draw the path.", "Know the run."], ["FRC autonomous authoring, from robot model", "to versioned Java handoff."]), 1920, 1080);
render("assets/video/chapter-plan-1920x1080.svg", videoCard("Bordeaux Plan chapter card", "01 · Plan", ["Shape the motion."], ["Build the spline while the physical", "limits stay in view."]), 1920, 1080);
render("assets/video/chapter-compose-1920x1080.svg", videoCard("Bordeaux Aquitaine chapter card", "02 · Aquitaine", ["Compose the run."], ["Connect paths, commands, waits,", "and sensor decisions."]), 1920, 1080);
render("assets/video/chapter-export-1920x1080.svg", videoCard("Bordeaux Java chapter card", "03 · Review + export", ["Keep the handoff", "inspectable."], ["Typed command events. Explicit review.", "No robot deployment from the editor."]), 1920, 1080);
render("assets/video/end-card-1920x1080.svg", videoCard("Bordeaux launch end card", "Bordeaux · 0.2 beta", ["Make the run", "understandable."], ["Download the beta and review every move.", "github.com/Zw96042/bordeaux"], "glass"), 1920, 1080);

render("assets/video/lower-third-1920x1080.svg", svg(1920, 1080, `<g transform="translate(88 850)" filter="url(#shadow)"><rect width="700" height="130" rx="18" fill="#0a0a0b" fill-opacity=".9" stroke="#fff" stroke-opacity=".12"/>${glass(16, 3, 124)}${brandLine(152, 58, { size: 34 })}${eyebrow(154, 91, "FRC trajectory authoring")}</g>`, { label: "Transparent Bordeaux video lower third" }), 1920, 1080);

render("assets/social/quote-card-1200x1200.svg", svg(1200, 1200, `${editorialBackground(1200, 1200)}${glass(60, 42, 210)}${eyebrow(282, 142, "Bordeaux principle 02")}${title(76, 500, ["Apply is", "explicit."], { size: 142 })}${body(84, 810, ["Every proposed path change is staged", "with Apply and Reject controls before", "it touches the project."], { size: 32 })}${brandLine(84, 1088, { size: 38 })}`, { background: palette.ink, label: "Bordeaux product principle quote card" }), 1200, 1200);

render("assets/wallpaper/desktop-2560x1440.svg", svg(2560, 1440, `${editorialBackground(2560, 1440)}${route(210, 262, 2110, 880, { strokeWidth: 13 })}${glass(1010, 350, 540)}${brandLine(1280, 1280, { size: 56, anchor: "middle" })}`, { background: palette.ink, label: "Bordeaux desktop wallpaper" }), 2560, 1440);
render("assets/wallpaper/mobile-1290x2796.svg", svg(1290, 2796, `${editorialBackground(1290, 2796)}${route(120, 370, 1030, 1380, { strokeWidth: 12 })}${glass(325, 1110, 640)}${brandLine(645, 2500, { size: 68, anchor: "middle" })}${eyebrow(645, 2570, "Draw the path · Know the run", "middle")}`, { background: palette.ink, label: "Bordeaux mobile wallpaper" }), 1290, 2796);

const keyArtRelativePath = "assets/generated/bordeaux-launch-key-art.png";
const keyArtSourceFrame = 78;
const keyArtSource = join(repoRoot, "prototypes/startup-animations/exports/spill-route.mp4");
const keyArtOutput = join(launchRoot, keyArtRelativePath);
const keyArtFilter = `[0:v]select=eq(n\\,${keyArtSourceFrame - 1}),split=2[bg][fg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=32[blur];[fg]scale=-2:1080[front];[blur][front]overlay=(W-w)/2:0,eq=brightness=-0.04:contrast=1.05:saturation=0.95,vignette=PI/7[out]`;
execFileSync(ffmpeg, ["-y", "-v", "error", "-i", keyArtSource, "-filter_complex", keyArtFilter, "-map", "[out]", "-frames:v", "1", keyArtOutput]);
exports.push({
  file: keyArtRelativePath,
  width: 1920,
  height: 1080,
  format: "PNG",
  source: "prototypes/startup-animations/exports/spill-route.mp4",
  sourceFrame: keyArtSourceFrame,
});

const marketingOgSvg = join(repoRoot, "marketing/assets/social/bordeaux-og.svg");
const marketingOgPng = join(repoRoot, "marketing/assets/social/bordeaux-og.png");
execFileSync(renderer, ["-w", "1200", "-h", "630", "-o", marketingOgPng, marketingOgSvg]);

writeFileSync(join(launchRoot, "assets/manifest.json"), `${JSON.stringify({ generator: "launch/generate-assets.mjs", canonicalLogoSource: canonicalGlassSource, palette, exports }, null, 2)}\n`);
console.log(`Generated ${exports.length} launch exports plus the marketing Open Graph image.`);
