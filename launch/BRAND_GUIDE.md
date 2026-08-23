# Bordeaux brand guide

## Core idea

**Cultivated engineering.** Bordeaux should feel precise enough for robot constraints and human enough to remain memorable during build season. The wine glass is the identity; the path is its active behavior.

Primary line: **Draw the path. Know the run.**

Supporting descriptor: **FRC trajectory authoring**

## Logo

Use the canonical full-color wine glass from `build/icon-assets/wine-glass.svg` on near-black or graphite surfaces. Generated full-color launch lockups embed that source directly. The light-background lockup is a contrast adaptation; the monochrome export is a true one-ink mark for reproduction where color is unavailable. The minimum clear space is the width of the glass stem on all sides of the bowl and base. Do not redraw the glass, change the wine hue independently, add grapes or bottles, put type inside the bowl, or use the spill as a decorative stain.

The lowercase `bordeaux` reveal belongs to the startup animation concept. Marketing headlines and lockups use **Bordeaux** with an initial capital.

## Color

| Role | Hex | Use |
| --- | --- | --- |
| Graphite | `#0a0a0b` | Primary background |
| Raised graphite | `#141317` | Cards and controls |
| Warm ivory | `#f5efe6` | Primary type and glass linework |
| Bordeaux | `#b95770` | Identity and path emphasis |
| Bordeaux deep | `#702238` | Liquid depth and gradients |
| Path periwinkle | `#7ea2ed` | Product-path endpoints and technical contrast |
| Muted warm gray | `#aaa4a0` | Secondary copy |

Keep burgundy and periwinkle sparse. Most frames should remain graphite and ivory.

## Typography

- Display: an old-style editorial serif such as Newsreader or the supplied system-serif fallback stack.
- Interface and body: Space Grotesk / a clean geometric sans.
- Labels and technical values: JetBrains Mono / a compact monospace.

Headlines are short, large, and tightly tracked. Body copy should remain below 65 characters per line. Uppercase mono labels use generous tracking and never carry long sentences.

## Graphic language

Use smooth cubic trajectories, circular or square waypoints, thin field grids, constraint readouts, and precise hairline borders. Glass reflections may be soft; product diagrams remain crisp. Do not use generic circuit patterns, purple-neon gradients, glassmorphism stacks, or decorative dashboards unrelated to the actual editor.

## Motion

Motion must explain state or identity. The defining transition is **wine → route**: a controlled burgundy pour resolves into a robot path. Daily UI motion stays between 120–220 ms; startup storytelling may use 1.9–3.4 seconds. Use ease-out for arrivals, ease-in-out for physical tipping, and linear motion for timeline progress. Reduced-motion users receive the end state with no simulated spill or camera travel.

## Voice

Clear, calm, and technically honest. Prefer “bounded candidates” to “optimal,” “proposes” to “fixes automatically,” and “export” to “deploy.” Bordeaux is beta software; safety validation stays with the team.
