# Bordeaux

Bordeaux is a lightweight desktop editor for authoring robot paths, autonomous routines, and Java command events. The maintained planners are `profiledSpline` and `optimizedTrajectory`; both build on the repository's shared path math, constraints, and stationary-action postprocessor. The optimizer is a bounded smoothing pass over the profiled trajectory, not an external solver.

Bordeaux is licensed under the [Apache License 2.0](LICENSE).

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

After the first tagged Java release publishes the `java-maven` branch, install the WPILib vendordep from `https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven/BordeauxLib2026.json`, then link the GradleRIO project in Bordeaux and choose **Install Java Support**. The app detects the vendordep and installs only its managed catalog configuration; it can fall back to bundled runtime and processor jars when the robot project must remain offline. See [java/README.md](java/README.md) for setup, generated command catalogs, and runtime APIs.

## Project files

`.bordeaux.json` files contain all paths, routines, and compact editor restoration metadata, including the selected path and linked Java project bookmark. Java trajectory export writes the bounded `bordeaux-trajectory/1.0` JSON consumed by the robot runtime.
