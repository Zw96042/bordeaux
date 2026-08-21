# Bordeaux

Electron/React desktop editor for robot paths, autonomous routines, and Java command events. Shared trajectory timing must agree across playback, routines, and export; optimization candidates are applied explicitly.

## Where to work

- `src/renderer/`: React UI, browser-domain helpers, assets, and styles.
- `src/electron/`: desktop integration, project files, robot transports, and workers.
- `src/shared/`: planner and serialization contracts shared across boundaries.
- `java/`: robot runtime and support integration.
- `tests/` and `benchmarks/`: correctness, integration, and planner validation.
- `docs/trajectory-optimization.md`, `docs/java/index.md`, and `docs/packaging.md`: task-specific workflows.

## Local commands

Use Node.js >=22.12, npm, and Java 17.

- `npm install`
- `npm run dev` (builds before starting Electron).
- `npm test`
- `npm run typecheck`
- `npm run build`
- Java changes: `npm run test:java`; integration changes: `npm run test:java-integration`.
- Desktop smoke check: `env -u ELECTRON_RUN_AS_NODE npm run test:smoke`.

CI also certifies fields and checks licenses. Packaging/release tasks have their own gates in `docs/packaging.md`; archive large local installers recoverably rather than discarding them.

## UI changes

Follow [the UI review procedure](docs/agents/ui-review.md) for renderer changes and release sign-off. Verify the rendered workflow and representative states; passing source tests alone is not visual verification.

## Robot boundary

Saving is local and must not open a robot connection. Push, full replacement, pin, and rollback are separate explicit actions. Preserve immutable revision review, readback, and matching disabled-runtime acknowledgment. Local deletion must not delete robot contents, and selective pushes must not silently become full replacement.

## The Lab and domain guidance

Specs, implementation tickets, bugs, and feature requests use The Lab project `bordeaux` through the `lab` CLI. See `docs/agents/issue-tracker.md`. Prefix Codex CLI operations with `THELAB_AUTHOR=codex`.

The owner grants standing authorization to publish and update Bordeaux plans, reviews, and their related findings/issues in The Lab project `bordeaux`, including internal repository analysis, file/line references, and verification results. Do not request per-document approval for this workflow. See the scope and destination in `docs/agents/issue-tracker.md`; platform approval controls still apply.

Use the five canonical triage roles in `docs/agents/triage-labels.md`, preserving unrelated tags. This is a single-context repository; use `docs/agents/domain.md` for vocabulary and relevant architectural decisions.
