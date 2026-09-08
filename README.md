# Bordeaux

Bordeaux is a lightweight desktop editor for authoring robot paths, autonomous routines, and robot command events. Normal trajectories use shared physics-aware timing and need no optimizer. Optional per-path optimization searches for faster geometry inside an adjustable corridor; compare the candidate and apply it to select the exact trajectory used by playback, routines, and export. See [trajectory optimization](docs/trajectory-optimization.md).

Bordeaux is a LabVIEW-only planner. Link a `.lvproj` to discover commands and their parameters, then export a selected path as a `.bdx` binary. The [binary contract](docs/labview/binary-format.md) defines the file layout and robot-code boundary.

## Develop

Requirements: Node.js 22.12+ and npm.

```text
npm install
npm run dev
```

The renderer source lives in `src/renderer` and builds with Vite to `dist-renderer`. `main.tsx` mounts the React application, feature components live under `components`, browser-side domain helpers under `lib`, and static resources under `assets` and `styles`. Renderer modules use explicit imports; no ordered scripts or application globals are required. Electron and shared planner code also live in `src`.

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

## LabVIEW integration

Choose a `.lvproj` or its containing folder. Project discovery reads project XML; NI inspection supplies saved VI connector types and parameter defaults. The command catalog contains stable command and condition IDs. Discovery never executes robot VIs.

Saving a path writes a local `.bdx` file. Binary export requires saved NI type evidence for command parameters; eventless paths can export without a linked catalog. Robot-code VIs read the file and return setpoints and command requests. The caller supplies measured pose, time, lifecycle state and motor/command integration. See [LabVIEW integration](docs/labview/index.md).

Robot push is a separate explicit action. Saving and local deletion do not connect to a robot or remove robot contents. Revision review, readback and matching disabled-runtime acknowledgment remain required where the configured robot receiver supports deployment.

## Project files

Mark a waypoint **Linkable** and give it a **Point name** to make it available for reuse. On another waypoint, use **Shared position → Use named point…**; only opted-in named points appear. Turning Linkable off hides the point from the picker without breaking existing links. Editing either point updates every linked occurrence; robot facing, tangent handles relative to the point, and stop settings remain local. **Unlink** makes that occurrence independent. Duplicating an entire path retains its shared positions; duplicating an individual waypoint creates an independent, offset point. Appended path endpoints also share position only.

For swerve paths, drag the start heading arrow or edit **Initial robot facing** independently of travel direction. Editing facing while tangent or look-at mode is active switches only the first segment to manual facing. **Entry speed (vi)** and **Exit speed (vf)** specify speed along the path, subject to trajectory limits. A waypoint’s explicit **Stop at entry/exit** overrides that boundary speed to zero; remove the stop to use a moving boundary. Tank heading follows the tangent.

Field feedback uses one compact status with an **Optimize** action when attention is needed; expanded **Details** holds diagnostics. Normal trajectory rebuilding remains automatic.

Open a folder to work there. `.bordeaux` project files retain project settings and editor state, while paths and routines are saved in the opened workspace.

## License and asset rights

The Bordeaux application and LabVIEW integration source are licensed under the [Apache License 2.0](LICENSE). The Bordeaux identity and bundled assets are governed separately; [RIGHTS.md](RIGHTS.md) records the trademark boundary, font terms, media rules, and provenance locations. Apache-2.0 does not grant permission to present a fork or product as an official Bordeaux release.
