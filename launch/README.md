# Bordeaux launch kit

This directory contains the launch system for Bordeaux `0.2.0-beta.2`: brand exports, campaign art, product feature cards, a website demo loop, a launch-film draft, copy for each primary channel, and production notes for a release-grade final edit.

## Start here

- [`BRAND_GUIDE.md`](BRAND_GUIDE.md) — identity, color, typography, image, and motion rules
- [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) — decisions and clearance required before a public release
- [`ASSET_PROVENANCE.md`](ASSET_PROVENANCE.md) — source and rights notes
- [`copy/announcement.md`](copy/announcement.md) — long-form launch announcement
- [`video/script.md`](video/script.md) — timed voiceover and on-screen plan
- [`exports/bordeaux-launch-draft.mp4`](exports/bordeaux-launch-draft.mp4) — 37.5-second 1080p silent edit with a silent audio track
- [`exports/bordeaux-product-demo.mp4`](exports/bordeaux-product-demo.mp4) — 18-second 1280×800 product walkthrough

## Asset families

The generator creates both SVG source and PNG export for:

- Horizontal dark/light wordmarks, stacked lockup, and monochrome mark
- 1200×630 Open Graph, 1080 square, 1080×1920 story, 1280×720 thumbnail, and 1200 quote card
- Plan, Aquitaine, and Java product feature cards
- 1920×1080 title, chapter, end, and transparent lower-third cards
- 2560×1440 desktop and 1290×2796 mobile wallpapers

The `assets/generated/` directory contains two supplemental directions:

- `bordeaux-brand-board.svg` and `.png` are deterministic internal identity boards produced by the asset generator. Their conceptual pseudo-interface is not product evidence.
- `bordeaux-launch-key-art.png` is a text-free 16:9 campaign still derived from the verified **Spill / Route** production master at frame 78.

## Regenerate

```sh
node launch/generate-assets.mjs
node prototypes/startup-animations/render-animations.mjs --film spill-route
bash launch/render-videos.sh
```

The startup command requires Blender 5.2 LTS; set `BLENDER_BIN` when it is not in a standard location. The launch renderer falls back to the static title card if the **Spill / Route** master is absent.

Other requirements: Node.js, Python 3, FFmpeg/FFprobe, and `rsvg-convert`. Source geometry, timing, and campaign exports are deterministic; encoded bytes and fallback-font metrics can vary with local tool and font versions.

## Recommended release set

1. Website hero and social unfurl: `assets/social/og-1200x630.png`
2. Main feed announcement: `assets/social/square-1080x1080.png`
3. Story/Reel cover: `assets/social/story-1080x1920.png`
4. YouTube thumbnail: `assets/social/youtube-thumbnail-1280x720.png`
5. Launch film: record the shots in `video/shot-list.csv`, then replace the code-built walkthrough in the supplied edit using `video/edit-notes.md`.
6. Startup choice: use the Blender-rendered **Spill / Route** for first launch and **Precision Lock** for repeat sessions. **Ribbon Flight** is the more editorial launch-media option. Review all three in `../prototypes/startup-animations/index.html`.
