# Bordeaux marketing site

Static, dependency-free production site for Bordeaux. Its Black Label direction pairs editorial typography with continuous warm-black surfaces and one concentrated wine-red ramp, alongside the exact articulated Chap rig used by `learn.wilsonzach.com`.

## Palette decision

Selected from the temporary palette lab on August 20, 2026:

- Direction: Black Label / Accent
- Keep: neutral black and charcoal surfaces, rich H18 wine red for primary actions and identity
- Reject: warm parchment and tan chapters, ambient claret over every dark surface, dusty rosé, and tawny vintage neutrals

## Preview

```sh
python3 -m http.server 4175 --directory marketing
```

Open `http://localhost:4175`.

## Included

- Responsive landing page with workflow, Java, accountability, FAQ, and download sections
- An indefinitely looping Chap hero animation with pause and reduced-motion handling as the sole illustrative figure
- Keyboard/touch navigation, reduced-motion handling, focus states, a skip link, and semantic structure
- Canonical, Open Graph, Twitter, JSON-LD, robots, sitemap, manifest, favicon, Apple touch icon, privacy page, and 404 page
- Local WOFF2 fonts with official sources, hashes, and OFL notices in `assets/fonts/`, plus no analytics or third-party runtime embeds

## Hosting

The canonical URL is currently assumed to be `https://bordeaux.wilsonzach.com/`. Update `index.html`, `privacy.html`, `robots.txt`, and `sitemap.xml` together if the production domain changes. Confirm release links, platform artifacts, version number, and repository licensing before publishing.

Deploy the contents of this directory at the site root. The site has no runtime dependencies or build step.
