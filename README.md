# Bordeaux

Bordeaux is a lightweight desktop editor for authoring robot paths, autonomous routines, and Java command events. Normal trajectories use shared physics-aware timing and need no optimizer. Optional per-path optimization searches for faster geometry inside an adjustable corridor; compare the candidate and apply it to select the exact trajectory used by playback, routines, and export. See [trajectory optimization](docs/trajectory-optimization.md).

LabVIEW 4.4 compatibility is preserved separately on the `archive/labview-4.4` branch and is intentionally absent from the main application.

## Develop

Requirements: Node.js 22.12+, npm, and Java 17.

```text
npm install
npm run dev
```

The renderer source lives in `src/renderer` and builds with Vite to `dist-renderer`. `main.tsx` mounts the React application, feature components live under `components`, browser-side domain helpers under `lib`, and static resources under `assets` and `styles`. Renderer modules use explicit imports; no ordered scripts or application globals are required. Electron and shared planner code also live in `src`; robot-side support lives in `java`.

## Verify

```text
npm test
npm run typecheck
npm run build
env -u ELECTRON_RUN_AS_NODE npm run test:smoke
```

Run `npm run verify:package` after producing an unpacked package. Release tags must match `package.json`; CI enforces this with `npm run verify:release-tag`.

Large local installers should be archived outside the worktree instead of discarded. See [local artifact hygiene](docs/packaging.md#local-artifact-hygiene) for recoverable archive/restore commands and safe Git cleanup boundaries.

Installed GitHub builds update on version-derived beta or production channels; Microsoft Store builds use Store-managed updates. See [desktop packaging](docs/packaging.md) for release workflows and signing requirements.

## Java robot integration

Link a GradleRIO project in Bordeaux and use **Install Java Support**. This is the sole supported setup path: it installs bounded runtime/processor jars and a managed Gradle script in the robot project. Start with the [Java integration guide](docs/java/index.md); use [java/README.md](java/README.md) as the runtime API reference.

The optional **Push to Robot** flow is a separate, explicit action: saving never opens a network connection. After a team wires the caller-driven Java mailbox, Bordeaux can pair to the robot over SSH/SFTP on a pit USB, Ethernet, or practice connection, review one immutable revision, stage it with read-back verification, and report it active only after the disabled runtime returns the matching acknowledgment. A compatible runtime also reports its bounded revision history, allowing an author to explicitly pin or roll back to a retained revision with a fresh nonce-bound acknowledgment while disabled; missing history entries cannot be rolled back. SSH/SFTP port 22 is unavailable on the FMS field network.

The editor now keeps **Paths** and **Routines** in a persistent library beside the field. Select a row to edit, use its actions to rename/duplicate/move it, and use **Push path** or **Push routine** without leaving the editor. Shift selects a range; Cmd/Ctrl selects individual paths for a batch push. Routines open a full flow workspace with a field-preview tab.

A selected push composes a complete revision from verified robot contents: selected paths replace the same IDs, while other paths and the robot’s current routine remain preserved. A routine push explicitly replaces the one deployed routine and includes its static/fallback/linked path dependencies. A local delete never deletes robot content. **Matches robot** describes a recent verified content comparison, not execution; stale or unassociated contents display **Unknown**. **Settings** contains robot connection, display units, and robot configuration. Its connection control opens push history, rollback, diagnostics, and full-project replacement.

Selective pushes require the updated Java mailbox’s `bordeaux-active-revision/1.0` read capability and a deployment baseline with robot-context metadata. After upgrading an older runtime or baseline, review **Replace all robot content** once in the robot connection surface. Older runtimes retain explicit full-project push support; Bordeaux never silently substitutes that operation for **Push path**. A routine without static paths cannot be the first robot snapshot under the existing Java format: push a path first.


## Project files

Mark a waypoint **Linkable** and give it a **Point name** to make it available for reuse. On another waypoint, use **Shared position → Use named point…**; only opted-in named points appear. Turning Linkable off hides the point from the picker without breaking existing links. Editing either point updates every linked occurrence; robot facing, tangent handles relative to the point, and stop settings remain local. **Unlink** makes that occurrence independent. Duplicating an entire path retains its shared positions; duplicating an individual waypoint creates an independent, offset point. Appended path endpoints also share position only.

For swerve paths, drag the start heading arrow or edit **Initial robot facing** independently of travel direction. Editing facing while tangent or look-at mode is active switches only the first segment to manual facing. **Entry speed (vi)** and **Exit speed (vf)** specify speed along the path, subject to trajectory limits. A waypoint’s explicit **Stop at entry/exit** overrides that boundary speed to zero; remove the stop to use a moving boundary. Tank heading follows the tangent.

Field feedback uses one compact status with an **Optimize** action when attention is needed; expanded **Details** holds diagnostics. Normal trajectory rebuilding remains automatic.

`.bordeaux.json` files contain all paths, routines, and compact editor restoration metadata, including the selected path and linked Java project bookmark. Java trajectory export writes the bounded `bordeaux-trajectory/1.0` JSON consumed by the robot runtime.

## License and asset rights

The Bordeaux application and Java robot-support source are licensed under the [Apache License 2.0](LICENSE). The Bordeaux identity and bundled assets are governed separately; [RIGHTS.md](RIGHTS.md) records the trademark boundary, font terms, media rules, and provenance locations. Apache-2.0 does not grant permission to present a fork or product as an official Bordeaux release.
