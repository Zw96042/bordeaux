# Bordeaux

Bordeaux is a lightweight desktop editor for authoring robot paths, autonomous routines, and Java command events. The maintained planners are `profiledSpline` and `optimizedTrajectory`; both build on the repository's shared path math, constraints, and stationary-action postprocessor. The optimizer is a bounded smoothing pass over the profiled trajectory, not an external solver.

LabVIEW 4.4 compatibility is preserved separately on the `archive/labview-4.4` branch and is intentionally absent from the main application.

## Develop

Requirements: Node.js 20+, npm, and Java 17.

```text
npm install
npm run dev
```

The canonical renderer is the dependency-free static application in `public/renderer`. Electron and shared planner code live in `src`; robot-side support lives in `java`.

## Verify

```text
npm test
npm run typecheck
npm run build
env -u ELECTRON_RUN_AS_NODE npm run test:smoke
```

Run `npm run verify:package` after producing an unpacked package. Release tags must match `package.json`; CI enforces this with `npm run verify:release-tag`.

## Java robot integration

Link a GradleRIO project in Bordeaux and use **Install Java Support**. This is the sole supported setup path: it installs bounded runtime/processor jars and a managed Gradle script in the robot project. See [java/README.md](java/README.md) for the generated command catalog and runtime APIs.

## Project files

`.bordeaux.json` files contain all paths, routines, and compact editor restoration metadata, including the selected path and linked Java project bookmark. Java trajectory export writes the bounded `bordeaux-trajectory/1.0` JSON consumed by the robot runtime.
