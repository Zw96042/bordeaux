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

- The canonical renderer is the static application in `public/legacy`. Its browser compatibility geometry mirrors the shared degree-five Bezier and vertex-blend clothoid formulas, including the torque-speed timing envelope, but remains an approximate preview because it does not import the compiled TypeScript planner. Keep the compact approximation disclosure and the renderer regression test aligned with shared changes.
- Bordeaux branding uses the complete WRLP Chap from `WRLP/public/chap/bird.svg`. Keep its path geometry unchanged; branding may only remap the source color classes and frame the art for each platform. The startup state reuses that full bird with WRLP's 460 ms stride rhythm, respects reduced-motion preferences, and removes itself after the React editor commits.
- Path checks distinguish measured violations from expected planner behavior. Only invalid geometry and values that actually exceed authored constraints count as issues; curvature- or rotation-limited slowdowns are neutral performance notes.
