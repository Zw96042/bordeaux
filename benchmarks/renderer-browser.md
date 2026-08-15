# Renderer browser benchmark

Run `npm run benchmark:renderer:browser` from a clean checkout after fetching
`origin/main`. The default protocol compares the merge base of `HEAD` and
`origin/main` with `HEAD`. Correctness runs in its own candidate process, then
one identical run per variant is discarded as warmup before four measured runs
per variant use an even AB/BA schedule. Raw JSON is written to the ignored
`.benchmark-results/renderer-browser.json` file.

The fixtures are Bordeaux-authored synthetic three-waypoint common and 100-waypoint
stress profiled splines in a 1440×900 offscreen Electron window. Each variant uses
its production Vite bundle. Before timing each candidate fixture,
the harness verifies that matching application geometry traversed the production
preview scheduler's worker request/result transport, then checks terminal pointer
coordinates, save/dirty behavior, undo, path-switch cancellation, and matching
waypoint/curve geometry. The transport observer is enabled only by the benchmark
file URL and is inert during normal application use. Each timing process performs
the same discarded application input movement. The candidate additionally proves
its worker transport, then switches to a silent timed sentinel that counts matching
interactive worker round trips and direct fallbacks without dispatching per-job
events. Upstream does not require this candidate-only observer.

Latency is measured from Electron input dispatch to the first compositor bitmap
that contains sample-specific colors on the exact dragged waypoint and
centerline nodes. The renderer applies those colors only after screen position,
SVG-local position, and centerline containment match the input; the main process
then verifies both colors in the offscreen `NativeImage`. The stress phase sends
pointer input at 120 Hz and reports frame-time, estimated dropped frames,
correct-curve update rate, and the longest correct-curve gap. Frame and geometry
samples are bounded by the first and last input receipts in the renderer's own
clock domain.

Useful overrides:

```sh
npm run benchmark:renderer:browser -- --baseline <ref> --candidate <ref>
npm run benchmark:renderer:browser -- --trials 6 --latency-samples 48 --stress-ms 3000
npm run benchmark:renderer:browser -- --correctness-only
npm run benchmark:renderer:browser -- --output .benchmark-results/custom.json
```

Keep the machine otherwise idle. Compare results from the same machine and
display stack; Electron, Chrome, Node, revisions, raw trials, and protocol are
recorded in the JSON report. Generated results are evidence, not source, and
must not be committed.

Each Electron child has a two-minute watchdog by default. Override it with
`--variant-timeout-ms` when deliberately running a slower fixture.
Full comparisons require an even `--trials` count so both variants occupy each
position in the measured pair equally often.
