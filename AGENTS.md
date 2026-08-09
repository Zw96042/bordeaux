# Bordeaux product invariants

These repository-local rules supplement the general agent instructions. LabVIEW 4.4 compatibility is preserved on `archive/labview-4.4`; it is intentionally not part of the main application.

## Planners and projects

- The supported planner IDs on `main` are `profiledSpline` and `optimizedTrajectory`.
- Projects without `plannerId` continue to use `profiledSpline` through the existing fallback.
- Do not silently change the geometry or timing of either planner. Optimized output must preserve authored stops and independently verify final velocity, acceleration, and deceleration limits.
- Keep browser path 2.0, unversioned project, and Bordeaux project 1.0 migrations working. Unknown historical planner IDs normalize to `profiledSpline`.
- Project Save serializes every path. Java trajectory export serializes every exportable path and the authored routine.
- Optional `project.editor` may persist `activePathId` and the machine-local Java project bookmark ID. Missing or unavailable bookmarks must not prevent a project from opening.
- Multi-path timing metadata is keyed by stable path ID rather than list index. Path renames mutate only on an explicit valid commit; add and duplicate select the new path and generate a unique human-readable name.
- Optional `project.pathFolders` stores stable `{id,name}` folders and optional `path.folderId` assigns a path. Deleting a folder unfiles its paths and never deletes them.

## Geometry and editing

- The canonical renderer is the static application in `public/renderer`. It mirrors the shared planner behavior closely but does not import compiled TypeScript; numeric differential tests protect the boundary.
- Path checks distinguish measured violations from expected planner behavior. Only invalid geometry and actual authored-constraint excesses count as issues; curvature- or rotation-limited slowdowns are neutral notes.
- Do not attach one-click geometry or timing mutations to a path check unless a cloned candidate demonstrably resolves that exact check, introduces no worse check, and is previewed before application.
- Clicking a path in Select mode selects its segment and never inserts a waypoint. Explicit insertion uses the actual segment. Cubic Bezier insertion preserves the curve through a de Casteljau split; arc and clothoid insertion use Apply/Cancel previews.
- Self-overlapping geometry uses transient ordered visit focus. Cycle conflicts deterministically and latch constraint, target, marker, and range drags to the chosen path fraction. Visit focus must not change project or Java serialization.
- Generic waypoint add controls enter W placement and wait for a field click. A W-click appends a new End; insertion inside a segment is explicit or Alt-click. Shift-click direct-delete works in every tool. Playback sliders must not suppress Space/V/W/R/M/C shortcuts.
- Optional `waypoint.segmentHeadingMode` belongs to the outgoing segment. Omission preserves the path default; tank drive always follows tangent. Insertion copies the original override to both halves, appending extends it, and reversal remaps it with geometry.
- `lookAt` is segment-only and stores its target as `waypoint.segmentLookAt`. Diagnose targets on the driven line and apply `driveBackward` only after resolving the point-facing angle.
- Heading laws remain continuous across segment-mode boundaries. Unwrap sampled heading and use the minimum-jerk transition policy; entering Manual or Targets acquires the first authored anchor in the contiguous outgoing law without overshoot.
- Optional `waypoint.headingTransition` owns the incoming/outgoing boundary. Omission means `after`, heading priority, and a 0.75 m blend. Reversal swaps before/after. Translation priority is swerve-only and uses the shared causal, braking-aware follower.
- Optional `waypoint.turnInPlace` requires a stopped waypoint. Shared stationary postprocessing emits `arrival → turn → jiggle → wait → departure`; individual planners must not double-count or collapse those phases.
- Endpoint jiggle remains compact final-waypoint metadata. Reject repeated directions and off-field extrema. Arbitrary-direction jiggle is swerve-only, and physical limits may lengthen the requested stroke time.
- Constraint ranges support proportional (`param`) and segment-local (`wp` plus `t0`/`t1`) anchoring. Continue reading legacy `dist` and whole-waypoint `wp` ranges.
- Optional `constraintRange.rotationPriority` defaults to heading. Translation priority preserves translational timing while the bounded angular follower may lag and catch up without overshoot; every overlapping active policy must choose translation.
- Constraint range labels describe the strongest actually tightened local limit using the deterministic velocity, acceleration, deceleration, angular-velocity, angular-acceleration tie order.

## Resource and release boundaries

- Reject planner, stationary-action, project-file, Java-export, and robot-runtime resource ceilings before proportional allocation whenever counts can be known in advance.
- Heavy planning, analysis, and serialization must not block the Electron main event loop at interactive scale.
- Production uses minified React assets, runtime-only ASAR contents, and the configured locale allowlist. Renderer and package verification enforce budgets.
- The Java reader and reference follower are robot-runtime code: keep parsing bounded and position-following lookup sublinear while preserving earliest monotonic matches at self-overlaps.
- Bordeaux branding is defined by the current checked-in product assets. Do not replace or redraw user-owned branding changes as incidental cleanup.

Before shipping, run:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `env -u ELECTRON_RUN_AS_NODE npm run test:smoke`
- packaged manifest verification for release builds
