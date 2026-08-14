# Bordeaux

Bordeaux is a lightweight desktop editor for authoring robot paths, autonomous routines, and Java command events. The maintained planners are `profiledSpline` and `optimizedTrajectory`; both build on the repository's shared path math, constraints, and stationary-action postprocessor. The optimizer is a bounded smoothing pass over the profiled trajectory, not an external solver.

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

Link a GradleRIO project in Bordeaux and use **Install Java Support**. This is the sole supported setup path: it installs bounded runtime/processor jars and a managed Gradle script in the robot project. See [java/README.md](java/README.md) for the generated command catalog and runtime APIs.

The optional **Push to Robot** flow is a separate, explicit action: saving never opens a network connection. After a team wires the caller-driven Java mailbox, Bordeaux can pair to the robot over SSH/SFTP on a pit USB, Ethernet, or practice connection, review one immutable revision, stage it with read-back verification, and report it active only after the disabled runtime returns the matching acknowledgment. SSH/SFTP port 22 is unavailable on the FMS field network.

## Project files

`.bordeaux.json` files contain all paths, routines, and compact editor restoration metadata, including the selected path and linked Java project bookmark. Java trajectory export writes the bounded `bordeaux-trajectory/1.0` JSON consumed by the robot runtime.

## License and asset rights

The Bordeaux application and Java robot-support source are licensed under the [Apache License 2.0](LICENSE). The Bordeaux identity and bundled assets are governed separately; [RIGHTS.md](RIGHTS.md) records the trademark boundary, font terms, media rules, and provenance locations. Apache-2.0 does not grant permission to present a fork or product as an official Bordeaux release.
