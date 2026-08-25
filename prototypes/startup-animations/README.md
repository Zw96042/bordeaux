# Bordeaux startup films

Three isolated startup-film prototypes, authored as real 3D scenes in Blender
and delivered as finished 60 fps video masters. The browser player only
selects, scrubs, and replays those masters; it does not assemble the motion
from DOM or SVG parts.

These are prototypes, not yet wired into Electron. Choose one direction before
production integration so the application does not inherit three competing
boot systems.

## Review the directions

    python3 -m http.server 4174 --directory prototypes/startup-animations

Open `http://localhost:4174`. Use the picker, keys `1`–`3`, left/right arrows,
or `R` to replay. The inspector can pause, scrub to a frame, change playback
speed, and copy the exact review configuration.

| Direction | Deliberate axis | Motion ingredients | Runtime | Best use |
| --- | --- | --- | ---: | --- |
| **Spill / Route** | Physical and narrative | Anticipation, weighted fall, counter-moving wine, a deforming liquid sheet, impact recoil, two splash ripples, twelve ballistic droplets, grounded path reveal, lens wipe, lockup. | 3.40 s | First launch, a major release, or the launch film. |
| **Ribbon Flight** | Sculptural and editorial | Suspended glass, camera travel, attached emission that pinches into a finite variable-width slug, three breakup droplets, reflected landing, editorial color cut, lockup. | 2.90 s | Launch film, keynote, or one-time onboarding. |
| **Precision Lock** | Precise and repeatable | A periwinkle trajectory orbit, sequential foot/stem/bowl construction, anchored wine fill, wordmark resolve. | 1.95 s | Repeat-session startup. |

The central feel check is simple: the glass must carry weight, liquid must lead
the eye rather than decorate the frame, and the lockup must arrive as the
consequence of the action. If a direction only reads as “logo pieces moving,”
it fails the gate.

## Render production masters

Requirements:

- Blender 5.2 LTS (set `BLENDER_BIN` when it is not installed in
  `/Applications` or mounted at `/Volumes/Blender`).
- Node.js.
- FFmpeg and FFprobe on `PATH`.

Render all three at 1440×900, 60 fps, 64 Eevee samples, with eight-step motion
blur:

    node prototypes/startup-animations/render-animations.mjs

Render one direction or tune machine concurrency:

    node prototypes/startup-animations/render-animations.mjs \
      --film spill-route --jobs 6

Encode a complete existing frame directory without rerendering:

    node prototypes/startup-animations/render-animations.mjs \
      --film spill-route --frames-dir /path/to/frames

The pipeline writes:

- `exports/*.mp4` — H.264 application/review masters, CRF 16.
- `exports/*.webm` — VP9 web masters, CRF 24.
- `exports/*-poster.png` — exact final-frame posters.
- `review/*-contact-sheet.png` — eight-frame motion review sheets.
- `motion-manifest.json` — durations, frame counts, decision axes, and paths.

Source geometry, materials, camera, lighting, liquid paths, droplets, and
timing live in `render-blender.py`. The scene has no random or host-time input,
so the authored frames are deterministic for a fixed Blender build and render
configuration. Space Grotesk and JetBrains Mono are bundled under the SIL Open
Font License; provenance and hashes are in `assets/fonts/`.

Before rendering Spill or Ribbon, the exporter runs a world-space causality
audit. The shared fill volume deforms against one gravity-level free surface;
there is no second cap rotating with the bowl. The audit rejects a scene when
that surface tilts, the duplicate meniscus becomes visible, the glass tips away
from the pouring lip, the Spill foot leaves its floor pivot, attached emission
misses the lip, Ribbon's released tail fails to advect, a sheet contains a gap,
the leader reverses direction, or the Spill stream misses the grounded route.
This is a geometry gate in addition to the full-sequence visual review; it is
not a substitute for watching the encoded film.

## Production handoff gate

Only integrate the selected master after checking it in the real startup path:

1. Start playback only while the app is genuinely booting.
2. If readiness wins the race, leave at the next authored cut instead of
   abruptly hiding the film.
3. If boot runs long or fails, transition to a real progress/error state; never
   loop a startup film.
4. Under `prefers-reduced-motion: reduce`, hold the final poster and require an
   explicit Play action in the review harness. In production, use the poster or
   a short opacity-only resolve.
5. Measure startup overhead after packaging. Decode and playback must not delay
   renderer readiness.

All three films are silent and contain no Chap artwork, so the earlier mascot
provenance blocker does not apply to these directions.
