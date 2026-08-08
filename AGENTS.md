# Bordeaux compatibility invariants

These repository-local rules supplement the general agent instructions. They exist because “Bordeaux-compatible” has two separate meanings: a proven LabVIEW file contract and a best-effort reconstruction of the LabVIEW trajectory math.

## Preserve existing behavior

- Compatibility work must be additive. Do not silently change the geometry or timing of `profiledSpline` or `optimizedTrajectory`.
- The supported planner IDs are `profiledSpline`, `optimizedTrajectory`, `labviewBezier`, and `labviewClothoid`.
- Projects without `plannerId` continue to use `profiledSpline` through the existing fallback.
- Optional `path.labview` settings default to:
  - `samplePeriodS: 0.02`
  - `minTurnRadiusM: 0.5`
  - `bezierTangentMode: "handles"`
  - the v4.4 booleans are `false` and `currentLimit` is `0`;
  - omitted `stoopidFastMps` follows the path's `maxVel`.
- Keep browser path 2.0, unversioned project, and Bordeaux project 1.0 migrations working. Imported `.bdx` files are migrated projects and must use Save As rather than overwriting the source binary.

## LabVIEW-compatible geometry

- `src/shared/math/labviewBezier.ts` is the degree-five compatibility implementation. Preserve:
  - `P0 = Wi`
  - `P1 = Wi + Ti/5`
  - `P2 = Ai/20 + 2P1 - Wi`
  - `P5 = Wi+1`
  - `P4 = Wi+1 - Ti+1/5`
  - `P3 = Ai+1/20 + 2P4 - Wi+1`
  - one shared tangent and second derivative at interior joins;
  - signed curvature `(x'y'' - y'x'') / (x'^2 + y'^2)^(3/2)`;
  - 24-point Gauss-Legendre arc length and distance-to-parameter inversion.
- Handle mode interprets degree-five handle deltas as tangents: `T = 5(handle - waypoint)`. Automatic mode uses the authored endpoint headings and generated interior tangents.
- A stopped interior waypoint is a Bezier geometry boundary. Build its incoming and outgoing quintic pieces independently: moving joins keep their shared first and second derivatives, while stop joins are intentionally only C0 so `prevC` and `nextC` can define a sharp turn without creating a loop.
- Preserve every authored Bezier segment boundary in planner geometry. Fixed-period timing splits at stopped waypoints so the stop is an exact zero-velocity tick; constraint time scaling applies only to motion, while waits are rounded up to whole sample periods and are never stretched.
- Apply `driveBackward` after resolving tangent or target/manual heading. Enforce active range angular acceleration plus directional global angular acceleration/deceleration during timing and path checks.
- In both LabVIEW compatibility planners, treat `robot.maxSpeed` as the free chassis speed, distinct from the path velocity cap. While accelerating use `activeMaxAccel * clamp(1 - |velocity| / robot.maxSpeed, 0, 1)`; keep deceleration independent. Constraint ranges select `activeMaxAccel` before the motor scale, and path checks must enforce the same envelope.
- `src/shared/math/labviewClothoid.ts` is a different model from the editor’s original endpoint-pose G1 clothoid. Preserve the vertex-blend construction:
  - normalized heading `theta(tau) = tau^2`;
  - hard numerical integration step `tau = 0.001`;
  - `tauMax = sqrt(|alpha| / 2)` for turns up to 90 degrees;
  - `sigma = 2 * Rmin * tauMax` and `kappa(s) = 2s / sigma^2`;
  - reflected exit spiral, signed left/right curvature, and a constant-radius extra arc beyond 90 degrees;
  - deterministic overlap handling that never crosses adjacent trims.
- Exact LabVIEW overlap preference, sigmoid `S-Curve2`, Fourier evaluation order, and Chebyshev distance mapping are not fully recoverable from the public repository. Do not claim bit-identical numerical parity without LabVIEW-generated golden fixtures.

## LabVIEW `.bdx` binary contract

- Current export is version `4.4` raw flattened LabVIEW data, not JSON, ZIP, an RSRC container, or a tagged stream.
- Every v4.4 file begins `00 00 00 03 34 2e 34` (U32 length plus `4.4`).
- Scalars are big-endian: DBL is 8 bytes, I32/U32 are 4 bytes, U16 enums are 2 bytes, and Boolean is one canonical byte (`00` or `01`).
- Strings and one-dimensional arrays have a big-endian U32 length/count. Clusters are concatenated in typedef order without padding.
- Linear values at the file boundary use feet, fps, fps², and fps³. Angles and angular rates use degrees. Internal planner values remain SI/radians.
- The velocity vector cluster order is `y` then `x`; do not “correct” it.
- The real `2CycleDepotPart1.bdx` fixture also proves that velocity-vector Y uses the opposite sign from increasing path-position Y. Preserve that screen-coordinate convention.
- Top-level v4.4 order is:
  1. version;
  2. Robot Backwards and Reverse Path;
  3. trajectory segments;
  4. commands;
  5. conditions/limits;
  6. updated waypoints;
  7. time and distance;
  8. Zero Velocity;
  9. Drive Type and Path Type;
  10. Pickup Balls;
  11. Current Limit;
  12. Zero Translational Velocity;
  13. Correct at Beginning of Path.
- `src/shared/export/labviewBdx.ts` is the schema-specific writer. `src/shared/export/labviewBdxReader.ts` is the strict reader.
- Reader and writer share hard resource ceilings. A writer must reject an export before allocation when its fixed-period sample count would exceed the strict reader's limit; every successful writer result must parse successfully.
- Preserve editable v4.4 top-level flags, StoopidFast, and small positive limits through import/export. Reject negative endpoint velocities, non-positive required limits, negative jerk, and out-of-field coordinates because the editable project model cannot represent them; never clamp binary values silently.
- StoopidFast remains a hidden compatibility field for lossless v4.4 round trips. Do not restore it as a normal editor input; new paths use the path velocity limit when it is omitted.
- v4.4 has no dedicated Max Robot Speed/free-speed field. Import uses `max(Velocity, StoopidFast)` as the conservative `robot.maxSpeed` fallback while preserving StoopidFast separately; this fallback is not evidence that the two concepts were identical in newer Bordeaux versions.
- For clothoid export, fixture-backed behavior includes `Linear N` / Segment Type 0 for an entirely straight section, an empty terminal trajectory cluster, the array length as the no-deceleration sentinel, and authored endpoint velocities in Conditions. See `docs/labview-bdx-fixtures.md`.
- The reader intentionally supports only v4.4 with empty commands and overrides. Older payload layouts and nonempty command arrays contain unproven types, including LVVariant and LabVIEW Path. Reject them clearly instead of guessing.
- One `.bdx` contains one selected path. Routine sequencing and multiple-path command orchestration are separate concerns.

## Product and verification boundaries

- The canonical renderer is the static application in `public/renderer`. Its browser compatibility geometry mirrors the shared degree-five Bezier and vertex-blend clothoid formulas, including the torque-speed timing envelope, but remains an approximate preview because it does not import the compiled TypeScript planner. Keep the compact approximation disclosure and the renderer regression test aligned with shared changes.
- Bordeaux branding uses the complete WRLP Chap from `WRLP/public/chap/bird.svg`. Keep its path geometry unchanged; branding may only remap the source color classes and frame the art for each platform. The startup state reuses that full bird with WRLP's 460 ms stride rhythm, respects reduced-motion preferences, and removes itself after the React editor commits.
- Path checks distinguish measured violations from expected planner behavior. Only invalid geometry and values that actually exceed authored constraints count as issues; curvature- or rotation-limited slowdowns are neutral performance notes.
- Do not attach one-click geometry or timing mutations to a path check unless the candidate is regenerated on a clone, demonstrably resolves that exact check, introduces no worse check, and is previewed before application.
- Clicking a path in Select mode selects its segment and must never insert a waypoint. Explicit waypoint insertion uses the actual segment. Cubic planners preserve the existing curve through a de Casteljau split; LabVIEW compatibility planners require an Apply/Cancel ghost preview because inserting a vertex can rebuild neighboring geometry.
- Self-overlapping geometry is edited through transient ordered visit focus, not persisted layers or displaced drawing. Resolve every nearby ordered-distance visit, cycle conflicts deterministically with repeated click or `[`/`]`, and latch constraint, target, marker, and range drags to the chosen path fraction so they cannot jump between coincident passes. Visit focus must not change project or `.bdx` serialization.
- Generic waypoint “add” controls enter the W placement tool and wait for a field click. A normal W-click appends a new End at the clicked field position; inserting inside an existing segment is a separate explicit action (or Alt-click). Shift-clicking an existing waypoint keeps the direct-delete shortcut in every tool, including W. Playback range sliders must not suppress the global Space/V/W/R/M/C shortcuts after scrubbing.
- Project Save serializes every path; `.bdx` export serializes only the selected path. Multi-path timing metadata must be keyed by stable path ID rather than list index. Path renames use a local draft and only mutate the project on an explicit valid commit; add and duplicate select the new path and generate a unique human-readable name.
- Optional `waypoint.segmentHeadingMode` belongs to the waypoint's outgoing segment and overrides `path.headingMode` only there. Omission preserves the path default; tank drive always follows tangent. Insertion copies the original segment override to both halves, appending extends the preceding override onto the new segment, and reversal remaps it with the segment geometry.
- `lookAt` is a segment-only heading mode. Its field-space target is stored as `waypoint.segmentLookAt` on the outgoing segment; it is never a path-wide default. Resolve the point-facing angle at every sample, preserve it through insertion/reversal, diagnose singular targets on the driven line, and apply `driveBackward` only after resolving the look-at angle.
- Heading laws must remain continuous when adjacent segments use different modes. Unwrap every sampled heading, then use the shared minimum-jerk correction over at most the first 0.75 m of the new segment so a look-at/manual/targets → tangent change cannot snap; angular constraints retime that finite transition. When entering Manual or Targets, acquire the first authored anchor in the contiguous outgoing law directly and monotonically; never acquire a path-global interpolated value from an interval where that law was inactive, because doing so can manufacture an overshoot before the real anchor.
- Optional `waypoint.headingTransition` authors the boundary between the incoming and outgoing heading laws at that interior waypoint. Omission preserves `after` placement, `heading` timing priority, and a `0.75 m` blend. `before`, `split`, and `after` choose which adjacent segment supplies the blend distance; reversal swaps before/after. `translation` timing priority is swerve-only and uses the same causal, braking-aware follower as translation-priority constraint ranges. On overlaps, translation wins only when every active range and transition policy selects it. LabVIEW `.bdx` flattens the resulting samples but cannot reconstruct this editor-only metadata.
- Optional `waypoint.turnInPlace` requires a stopped waypoint. It is a real stationary timeline phase after arrival and before `wait`: position, distance, and linear velocity remain fixed while a minimum-jerk angular move observes the authored angular velocity, acceleration, and jerk limits. The planner adapter removes waits from raw planner input, then the shared stationary post-processor emits `arrival → turn → wait → departure` samples for every planner; preserve that ownership so optimized retiming cannot collapse waits or double-count a turn. LabVIEW `.bdx` carries the flattened samples but cannot reconstruct this editor-only action from Updated Waypoints.
- Endpoint jiggle is compact metadata on the final waypoint, expanded by the shared stationary-action postprocessor without creating authored waypoints. Each configured stroke moves to an exact radial distance and returns; reject repeated directions and off-field extrema. `strokeTimeS` is the requested minimum duration of one complete outbound-and-return stroke; velocity, acceleration, deceleration, and motor free-speed limits may lengthen it. Action order is `arrival → turn-in-place → jiggle → wait`. Arbitrary-direction jiggle is supported only for swerve drive; tank drive rejects it until a physically constrained turn-and-reverse action exists. LabVIEW `.bdx` flattens the resulting samples but cannot reconstruct the editor-only jiggle metadata on import.
- Optional `project.pathFolders` stores stable `{id,name}` folders and optional `path.folderId` assigns a path. Missing fields mean Unfiled. Deleting a folder unfiles its paths and never deletes them.
- New constraint ranges expose proportional (`param`) and segment-local (`wp` plus `t0`/`t1`) anchoring. Local endpoints store a segment index and local arc-length fraction so edits to unrelated segments do not slide the range. Continue reading legacy `dist` and whole-waypoint `wp` ranges, but do not present fixed distance as spatially fixed.
- Optional `constraintRange.rotationPriority` is `heading` or `translation`. Omission means `heading` and preserves the existing behavior: translation may be retimed so the authored spatial heading law stays within angular limits. `translation` is swerve-only; it preserves translational timing while a causal, braking-aware angular follower obeys active omega and directional alpha limits, so heading may lag and catch up continuously without overshooting a settled target. If a stopped endpoint is still behind, append fixed-period stationary catch-up samples; a moving endpoint with unresolved error is invalid. If ranges overlap, every active range must select `translation` for translation to take priority. LabVIEW `.bdx` flattens the resulting samples but cannot reconstruct this editor-only policy on import.
- Constraint range labels must describe the strongest actually tightened local limit rather than an unchanged value copied from the global constraints. Compare normalized value-to-baseline ratios with a deterministic velocity, acceleration, deceleration, angular-velocity, angular-acceleration tie order; omit a numeric field badge when no local numeric limit is tighter.
- A valid structural round trip is `buildLabviewBdx` → `parseLabviewBdx` with EOF consumed and all units preserved.
- Before changing compatibility code, run the focused geometry, reader, and compatibility tests. Before shipping, run:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
  - `env -u ELECTRON_RUN_AS_NODE npm run test:smoke` in environments that inject Electron’s Node-only mode.
- The supplied `2CycleDepotPart1.bdx` is a real fixture, but it covers only a straight clothoid with a nonempty command. Byte-for-byte acceptance still requires controlled command-free curved clothoid and Bezier fixtures generated by the exact rebuilt LabVIEW `Versioned Write.vi`. A locally generated fixture proves regression stability, not LabVIEW identity.
