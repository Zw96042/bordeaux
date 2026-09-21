# Playback distance changes when acceleration changes

## Finding and evidence limits

The reported symptom is that the same **Normal** path travels a different distance after changing maximum acceleration. The red trace is the commanded velocity, not measured robot velocity.

A preserved September 12 capture of `Auto Play Path.vi` shows a concrete timing defect: the outer 20 ms loop stops when its iteration index reaches `Array Size(Samples) - 1`, while `BDX Time Step DT.vi` advances a separate trajectory clock by 0.02 seconds. Bordeaux samples have explicit, **unevenly spaced timestamps**. Their count does not specify how many 20 ms control ticks the trajectory needs. A slower acceleration profile can therefore be stopped long before its final timestamp.

The capture is `.scratch/robot-testing-20260912/auto-current.png`; its companion JSON identifies the inspected file as `C:/Users/zwatx/codex-workspaces/apprentice-runtime-20260907/integration-source/Robot Code/Drive/Commands/Auto Play Path.vi` and records `executed: false`, `saved: false`. This is evidence of that captured diagram, not verification of the currently deployed VI. The current XPS caller and its linked helper revisions have not been inspected for this investigation. **No native VI correction has been applied.**

On September 18 the owner confirmed that the affected project was under `codex-workspaces` on XPS and that XPS was offline. Inspecting and correcting its current VI remains blocked until that machine is available.

## Original export reproduction

Before export densification, the [binary export regression](../../tests/exportDistanceInvariant.test.ts) produced the table below. It builds a straight 3 m Normal path, changes maximum acceleration and deceleration together, exports real BDX bytes, and independently decodes their double-precision timestamps, speeds and travel headings. Trapezoidal integration uses each actual timestamp interval.

| Acceleration/deceleration (m/s²) | Samples | Duration (s) | Full exported velocity area (m) | Area before the captured loop's 1.12 s cutoff (m) |
| --- | ---: | ---: | ---: | ---: |
| 0.3 | 57 | 6.460432 | 2.999999429 | 0.181220 |
| 1 | 57 | 3.599055 | 3.000000467 | 0.571757 |
| 3 | 57 | 2.143098 | 3.000000298 | 1.489143 |
| 8 | 57 | 1.387570 | 3.000000235 | 2.716489 |

The cutoff column models integration through `(57 - 1) × 0.02 = 1.12 s`; it is not a measured robot distance or an exact simulation of control-loop sample-and-hold behavior. Full exported distance differs by less than one micrometer here. At the lowest acceleration, adjacent exported timestamps differ by approximately 0.064–0.560 s; at the highest, by 0.015–0.116 s. Neither file is a 20 ms row table.

Run from the repository root:

```sh
BORDEAUX_DISTANCE_PROBE=1 npx vitest run tests/exportDistanceInvariant.test.ts
```

This reproduction does not justify scaling planner velocities or distances. It establishes correct velocity area for these exported straight-path fixtures and demonstrates the captured caller's truncation mechanism. It does not establish the current robot's wiring, physical tracking, or every possible trajectory.

## Export sampling correction

The BDX writer now inserts samples into intervals longer than 20 ms. It preserves every original timestamp and velocity corner, the final endpoint, total duration/distance, event times and remapped follow-section boundaries. Slower trajectories therefore receive more output samples. The same regression now yields:

| Acceleration/deceleration (m/s²) | Exported samples | Duration (s) | Velocity area (m) |
| --- | ---: | ---: | ---: |
| 0.3 | 352 | 6.460432 | 2.999999429 |
| 1 | 210 | 3.599055 | 3.000000467 |
| 3 | 141 | 2.143098 | 3.000000298 |
| 8 | 92 | 1.387570 | 3.000000235 |

The regression checks gap size, acceleration bounds and full distance before the captured count-based cutoff. With intervals no longer than 20 ms, that cutoff cannot precede the final timestamp in these nominal-cadence tests. The old caller can still wait with zero output after motion finishes (roughly 0.4–0.7 seconds in these fixtures) until its count condition ends the outer loop. This does not change the current VI or verify its execution.

Intervals remain variable because preserving velocity peaks avoids the area loss caused by replacing them with a uniform grid. Play by timestamps; consuming one row every 20 ms is still incorrect. Original planner output and already-exported files are unchanged. Regenerate/push a BDX file to obtain denser samples. The caller correction below remains the proper way to handle old files, actual loop timing and natural completion.

## Minimal caller correction to review in LabVIEW

First inspect the current `Auto Play Path.vi` and its actual linked `BDX Time Step DT.vi`. If they match the preserved diagram and helper contract below:

1. Keep the selected path's complete `Samples[]` fixed throughout playback. Pass it to the time-step helper, which selects/interpolates samples by trajectory time.
2. Replace **only** the `i >= Array Size(Samples) - 1` completion branch with a Boolean obtained from the helper's `Status U8`:

   ```text
   Finished = (Status U8 AND 0x02) != 0
   ```

   Use a numeric bitwise AND and an unsigned-byte mask. Do not compare the whole status to 2: normal accepted completion is status 3, combining Valid and Finished.
3. Retain the existing robot-mode, operation, stop, disabled, preflight, and error handling. Preserve the post-loop zero-output behavior. A cancellation or fault is a stop reason, not successful completion. The existing unconditional `Auto Done?` alone does not distinguish these outcomes.
4. Feed `State Out` back to `State In` through the loop's state storage. Initialize the complete state to zero once per new path execution: DBL `Next Clock s = 0`, DBL `Previous Clock s = 0`, U8 `Terminal Status = 0`. Alternatively, pulse Reset for initialization when its prerequisites are satisfied; **do not hold Reset true every tick**.
5. Keep `dt s` in seconds: a nominal 20 ms loop uses `0.020`, not `20`. A fixed 0.020 assumes the actual loop meets that cadence. Check overruns/elapsed time separately; changing the termination branch does not repair a slow or irregular real control loop.

Do not reset state during an ongoing path or clear terminal/fault state merely to continue motion. For another path, use a new execution generation and reinitialize state deliberately.

## Verified helper recipe contract

The preserved authoring recipes are `.scratch/localization-20260911/dt-state-investigation/build-bdx-time-step.mjs` and `build-bdx-time-step-dt.mjs`. Reading those recipes establishes intended helper behavior; it does not prove that the current saved or deployed VI has those wires.

| Status mask | Meaning |
| --- | --- |
| `0x01` | Preflight, clock and sampled data valid; does not itself authorize motion |
| `0x02` | Finished at the clamped final timestamp with valid data |
| `0x04` | Permit commands before natural finish |
| `0x08` | Cancel caller-owned autonomy commands requested |
| `0x10` | Clock fault |

Natural success requires valid Finished with no cancellation/fault and the caller's active/safety conditions satisfied. Fault/cancel status must retain its separate handling even when another status bit is present. The DT recipe can expose Finished while inactive at the endpoint without accepting/latching completion; callers must not treat that as a new successful active execution.

The DT state contract requires finite positive `dt s`. Reset is accepted only with valid dt, Stop and Disabled false, and Preflight Valid true; it can initialize while inactive. Active accepted calls starting from zero sample at `0`, `0.020`, `0.040`, and so on. An interval crossing the endpoint clamps **Next Clock** to the final timestamp; the following active invocation samples that endpoint and records terminal status 3. Keep that final invocation: stopping as soon as Next Clock reaches the duration would bypass it. Inactive calls hold clocks, and a latched terminal/fault state requires a deliberate reset for another execution.

At natural finish, this helper outputs zero motion and clears Permit. Endpoint events have their own caller-owned phase; do not accidentally suppress them by reusing the interior Permit bit. The helper does not provide measured-pose feedback or prove physical arrival.

## Verification after editing the current VI

Inspect the actual edited stop-condition wiring and helper linkage, then exercise the current helper/caller without motor output. Run the same geometry with low and high acceleration. Confirm clock progression continues to each file's final timestamp, Finished ends the loop, and output becomes zero. Also check disable, stop, wrong operation, invalid input and clock faults still stop safely without reporting success. Physical travel remains a separate check after the caller timing is verified.
