# Bordeaux Java support

This Java 17 bundle provides the robot-side half of Bordeaux commands for WPILib 2026.2.2. It uses stable IDs across the desktop/robot boundary; it never serializes Java objects, reflects over robot classes in the editor, or asks Bordeaux to instantiate subsystems.

## Modules

- `annotations`: source-retained command, condition, parameter, and bounded trajectory-generator annotations.
- `processor`: an aggregating annotation processor that validates authored factories and predicates, then generates both `META-INF/bordeaux/commands.json` and direct-call `dev.bordeaux.generated.BordeauxGeneratedBindings`.
- `runtime`: a bounded `bordeaux-trajectory/1.0` reader, generated capabilities API, exact argument conversion, and a jitter-safe WPILib command event runner.

The desktop app's **Install Java Support** action is the one supported integration path. It copies the runtime and processor jars into the linked robot project, adds one managed Gradle script, and creates the fixed `bordeauxCatalog` task. A separately published Gradle plugin is intentionally not maintained.

Factories must be public methods on public provider types and return `edu.wpi.first.wpilibj2.command.Command`. Non-static providers are explicit constructor dependencies of the generated bindings, keeping subsystem ownership in `RobotContainer`. Supported authored values are numeric/boolean primitives and wrappers, strings, enums, exact `long`/`BigInteger`/`BigDecimal`, arrays, collections, string-key maps, optionals, records, and public Jackson-deserializable objects with mutable public data fields plus a public no-argument constructor. `char`/`Character`, unsupported, recursive, or opaque shapes fail compilation.

Call `BordeauxBindings.generatedCapabilities(provider1, provider2, ...)` to construct the generated command, condition, and trajectory-generator capabilities. Provider order does not matter. This fixed bootstrap avoids importing a class emitted during the processor's final aggregation round, while the generated class still owns direct typed calls and compiled catalog identity. `generated(...)` remains available for command-only integrations.

See [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot) for a complete GradleRIO project and [`examples`](examples) for integration snippets. The fixed `bordeauxCatalog` task copies the processor resource to `build/bordeaux/catalog-v1.json`, which is the only generated project file the app reads.

## Catalog identity

Set `-Abordeaux.catalogId=<team-stable-id>` on `JavaCompile`; otherwise the first provider type is the fallback ID. The generated catalog uses `schemaVersion: "1.3"`, `supportVersion: "0.4.0"`, and a deterministic `catalogHash`. It includes the closed `bordeaux.wait` built-in and any strictly bounded `@BordeauxTrajectoryGenerator` descriptors. Both the ID and hash are compiled into `BordeauxGeneratedBindings` and its capabilities.

The hash is `sha256:` plus lowercase SHA-256 of UTF-8 canonical JSON for `{builtIns,commands,conditions,trajectoryGenerators}`. Capability arrays are sorted by ID, authored inputs by name, and canonical JSON recursively sorts every object key lexicographically. A `bordeaux-trajectory/1.0` document carries the same ID and hash in `catalog`; capability runners reject either mismatch and any unknown condition before scheduling anything.

## Runtime lifecycle

Load one selected path with `BordeauxTrajectoryReader.read(input, pathIdOrName)`, construct `BordeauxEventRunner` from generated capabilities, then call `periodic(elapsedS, measuredFraction)` from the normal robot loop. Time events use elapsed path time; position events use monotonic measured progress even on a time-followed section. Optional condition IDs are preflighted before the path starts, and repeated events catch up through their authored end window without loop-jitter skips. Event IDs are required and duplicate IDs are rejected. Generated bindings reject missing, unknown, malformed, or out-of-range arguments again on the robot before creating a command.

For trajectory references, construct `BordeauxReferenceFollower` from that selected path and call `update(dtS, measuredXM, measuredYM)` each robot loop. Time sections advance on a section-local clock. Position sections advance monotonically from the measured field pose, use a short sample lookahead, and do not complete until the robot reaches the section endpoint. The returned `BordeauxSample` is a reference for the team's drivetrain controller; the runtime deliberately does not own drivetrain construction or odometry.

For a multi-path autonomous routine, load the document with `BordeauxTrajectoryReader.readWithRoutine(...)`, then construct `BordeauxRoutineRunner` with that document and generated capabilities. Routines without a wait can use `start()` and `completePath(...)`, which return the next stable path ID or an empty result at completion. Routines containing `bordeaux.wait` use `startProgress()`, `completePathProgress(...)`, and `periodic()` from the normal robot loop; each call returns `Path`, `Waiting`, or `Complete`, so a wait cannot be mistaken for completion. The runner owns no timer command and only resumes the routine when the caller invokes `periodic()`. Every decision condition is preflighted before start. This explicit routine API rejects simulation-only function steps, unknown path references, duplicate node IDs, oversized trees, unknown built-ins, and malformed wait arguments, while the selected-path `read(...)` API remains compatible with older 1.0 exports containing simulation-only routine metadata.

`endPath()`, `stop()`, `close()`, and `reset()` cancel only commands from events that set `cancelOnPathEnd: true`; ordinary commands scheduled by an event are left alone. `reset()` also clears exactly-once state for another run. Elapsed time cannot move backward without a reset.

## Optional Bordeaux push mailbox

Teams that opt into desktop-to-robot pushes provision `/home/lvuser/deploy/bordeaux/push-v1` with `inbox` and `acks` subdirectories, construct `BordeauxRevisionService` with their disabled supplier and compiled compatibility, then construct `BordeauxRobotMailboxService`. Call `periodic()` from `robotPeriodic` so `status.json` follows enabled transitions immediately; unchanged loops do not rewrite it. It accepts only the nonce-bound revision files written by Bordeaux, rejects activation unless the robot is disabled, writes nonce-bound acknowledgments and state-changing status updates atomically, and never starts a listener, watcher, command, or network connection. The mailbox leaves a candidate in place if acknowledgment publication fails, so the next robot-loop poll can recover the persisted activation acknowledgment safely.

The same mailbox accepts only strict nonce-bound `*.bordeaux-retention.json` controls for explicit disabled-only rollback and pin actions. Runtime state retains the five newest accepted revisions plus one older pinned revision, reports their exact retained/missing/pinned state in `status.json`, and only ever removes a digest-derived immutable payload after its replacement manifest is durable. It does not enumerate or recursively delete revision storage, so files from an older or unknown manifest are never swept up by retention cleanup.

```java
var namespace = Path.of(BordeauxRobotStatusPublisher.PRODUCTION_DEPLOYMENT_NAMESPACE);
Files.createDirectories(namespace.resolve("inbox"));
Files.createDirectories(namespace.resolve("acks"));
var compatibility = new BordeauxRuntimeCompatibility(
    capabilities.catalogId(), capabilities.catalogHash(), "0.4.0",
    "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
var revisions = new BordeauxRevisionService(
    namespace.resolve("state"), 2468, DriverStation::isDisabled, compatibility);
var mailbox = new BordeauxRobotMailboxService(namespace, revisions);

// Robot.robotPeriodic():
mailbox.periodic();
```

Replace the team number and seasonal field identity with the values compiled into the robot project. Directory provisioning belongs in robot initialization, and mailbox failures should be reported through `DriverStation.reportError` without crashing the control loop.

## Build and test

From this directory:

```text
./gradlew test
./gradlew build
```

`build` also writes the two installer artifacts expected by the desktop app: `dist/bordeaux-runtime.jar` and `dist/bordeaux-processor.jar`. Both include the source-retained annotation classes so the app's two-file Gradle installation works without a third annotations artifact; Jackson and WPILib remain supplied by the GradleRIO project.

The only non-WPILib library declared directly is Jackson Databind 2.18.3, which WPILib already uses for JSON data. The explicit API gives the standalone runtime deterministic resource-limit behavior. The processor remains dependency-free, and top-level `Optional<T>` arguments are converted without an extra Jackson module.

## License

The Bordeaux Java robot-support source is licensed under the [Apache License 2.0](../LICENSE). The runtime and processor jars include the license and notice under `META-INF`; [the repository rights record](../RIGHTS.md) describes the separate Bordeaux identity and asset terms.
