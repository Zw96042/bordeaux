# Trajectory optimization

Draw and constrain a normal path first. The initial editing preview is provisional until normal planning finishes. Both normal and optimized trajectories use the same robot limits and heading constraints; optimization does not weaken the normal planner.

Choose **Optimize** in the toolbar to open the inspector and start a quick search. Opening an existing result does not rerun it. Click the **Normal** or **Optimized** time row to preview; **In use** marks the saved selection. **Apply optimized** saves the candidate for that path. Previewing alone never changes the selection, and closing the inspector restores it. **Use normal** clears the saved optimization.

**Search settings** contains **Path freedom** (0.03–1.5 m, displayed and edited in your preferred units), **Quick search** (five seconds, up to 24 candidates), **Search deeper** (fifteen seconds, up to 48), and **Optimize all**. The corridor band shows allowed route deviation; swept-footprint and field-clearance checks still apply. Required waypoints, headings, stops, waits, and events stay fixed. Search outcomes and constraint diagnostics are available under **Details**.

A search can finish early when no further improvement is found. A physics evaluation cannot be interrupted in the middle, so the worker has a separate hard deadline. Validated checkpoints preserve the best available candidate if the worker times out or is canceled. Background completion never applies a result. **Optimize all** searches paths sequentially and stages candidates for individual application; it preserves existing selections.

An already-good route may have no meaningful gain. Improvements must save at least the greater of 20 ms or 0.5% of normal time. The search is bounded and does not prove a global optimum. Current geometry search varies Bézier handle lengths while preserving handle directions. Mixed geometry, jiggle actions, or ambiguous portal topology can retain normal timing with an explicit unsupported-search reason.

## Saved-result contract

`PathDoc.optimization` stores the corridor and optional accepted artifact. The artifact carries its planner version, physical input identity, resolution, and exact result samples/geometry/actions/markers. Cosmetic path names, folders, and robot planning notes do not invalidate it. Changing geometry, constraints, robot physics, field revision, or corridor makes it outdated: playback, routine timing, and export then use the current normal trajectory automatically. The saved artifact remains available if the edit is undone; no new optimization is applied automatically. An artifact that matches current inputs but fails validation still blocks export until the user chooses normal or applies a valid candidate.

Project files with a legacy project-wide `plannerId` still load. That field no longer launches optimization or chooses a fresh solve at export; without a per-path accepted artifact, the path uses normal timing. BDX sample format and Java trajectory readers remain unchanged.

Input identity and structural checks live in `src/shared/planners/acceptedTrajectoryIdentity.ts`. Independent accepted-result validation and exact export selection live in `acceptedTrajectory.ts` and `src/shared/export/bdx.ts`. Keep physics validation in the worker/export boundary, off the renderer's main thread. `path-optimization.js` owns explicit candidate jobs; the project owns applied selections. A progress result is never an applied result.

## Verification

Run `npm test`, `npm run typecheck`, and `npm run verify:renderer`. After building the renderer, run `node scripts/verify-optimizer-ui.mjs` for the real Electron/worker workflow, including idle stability, compare/apply, persistence, stale selection, and batch staging. This runner uses an isolated profile and in-memory project storage. Tests requiring local IPC/TCP sockets need an execution environment that permits them.
