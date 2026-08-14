# Bordeaux Java support

This Java 17 bundle provides the robot-side half of Bordeaux commands for WPILib 2026.2.2. It uses stable IDs across the desktop/robot boundary; it never serializes Java objects, reflects over robot classes in the editor, or asks Bordeaux to instantiate subsystems.

## Modules

- `annotations`: source-retained `@BordeauxCommand` and `@BordeauxParam` annotations.
- `processor`: an aggregating annotation processor that validates authored factories and generates both `META-INF/bordeaux/commands.json` and direct-call `dev.bordeaux.generated.BordeauxGeneratedBindings`.
- `runtime`: a bounded `bordeaux-trajectory/1.0` reader, generated registry API, exact argument conversion, and a jitter-safe WPILib command event runner.

The desktop app's **Install Java Support** action is the one supported integration path. It copies the runtime and processor jars into the linked robot project, adds one managed Gradle script, and creates the fixed `bordeauxCatalog` task. A separately published Gradle plugin is intentionally not maintained.

Factories must be public methods on public provider types and return `edu.wpi.first.wpilibj2.command.Command`. Non-static providers are explicit constructor dependencies of the generated bindings, keeping subsystem ownership in `RobotContainer`. Supported authored values are numeric/boolean primitives and wrappers, strings, enums, exact `long`/`BigInteger`/`BigDecimal`, arrays, collections, string-key maps, optionals, records, and public Jackson-deserializable objects with mutable public data fields plus a public no-argument constructor. `char`/`Character`, unsupported, recursive, or opaque shapes fail compilation.

Call `BordeauxBindings.generated(provider1, provider2, ...)` to construct the generated registry. Provider order does not matter. This fixed bootstrap avoids importing a class emitted during the processor's final aggregation round, while the generated class still owns direct typed calls and compiled catalog identity.

See [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot) for a complete GradleRIO project and [`examples`](examples) for integration snippets. The fixed `bordeauxCatalog` task copies the processor resource to `build/bordeaux/catalog-v1.json`, which is the only generated project file the app reads.

## Catalog identity

Set `-Abordeaux.catalogId=<team-stable-id>` on `JavaCompile`; otherwise the first provider type is the fallback ID. The generated catalog uses `schemaVersion: "1.0"`, `supportVersion: "0.1.0"`, and a deterministic `catalogHash`. Both the ID and hash are compiled into `BordeauxGeneratedBindings` and its registry.

The hash is `sha256:` plus lowercase SHA-256 of UTF-8 canonical JSON for the `commands` array only. Commands are sorted by ID and parameters by name. Canonical JSON recursively sorts every object key lexicographically, preserves array order, uses normal JSON string escaping, and contains no insignificant whitespace. A `bordeaux-trajectory/1.0` document carries the same ID and hash in `catalog`; `BordeauxEventRunner` rejects either mismatch before scheduling anything.

## Runtime lifecycle

Load one selected path with `BordeauxTrajectoryReader.read(input, pathIdOrName)`, construct `BordeauxEventRunner`, then call `periodic(elapsedS, measuredFraction)` from the normal robot loop. Time events use elapsed path time; position events use monotonic measured progress even on a time-followed section. Optional condition IDs are resolved through `BordeauxConditionRegistry`, and repeated events catch up through their authored end window without loop-jitter skips. Event IDs are required and duplicate IDs are rejected. Generated bindings reject missing, unknown, malformed, or out-of-range arguments again on the robot before creating a command.

For trajectory references, construct `BordeauxReferenceFollower` from that selected path and call `update(dtS, measuredXM, measuredYM)` each robot loop. Time sections advance on a section-local clock. Position sections advance monotonically from the measured field pose, use a short sample lookahead, and do not complete until the robot reaches the section endpoint. The returned `BordeauxSample` is a reference for the team's drivetrain controller; the runtime deliberately does not own drivetrain construction or odometry.

For a multi-path autonomous routine, load the document with `BordeauxTrajectoryReader.readWithRoutine(...)`, then construct `BordeauxRoutineRunner` with that document, command registry, and condition registry. `start()` returns the first stable path ID. After that trajectory finishes, pass its ID to `completePath(...)`; the runner evaluates sensor decisions, schedules bound between-path commands, and returns the next path ID. An empty result means the routine is complete. This explicit routine API rejects simulation-only function steps, unknown path references, duplicate node IDs, and oversized trees, while the selected-path `read(...)` API remains compatible with older 1.0 exports containing simulation-only routine metadata.

`endPath()`, `stop()`, `close()`, and `reset()` cancel only commands from events that set `cancelOnPathEnd: true`; ordinary commands scheduled by an event are left alone. `reset()` also clears exactly-once state for another run. Elapsed time cannot move backward without a reset.

## Optional Bordeaux push mailbox

Teams that opt into desktop-to-robot pushes provision `/home/lvuser/deploy/bordeaux/push-v1` with `inbox` and `acks` subdirectories, construct `BordeauxRevisionService` with their disabled supplier and compiled compatibility, then construct `BordeauxRobotMailboxService`. Call `periodic()` from `robotPeriodic` so `status.json` follows enabled transitions immediately; unchanged loops do not rewrite it. It accepts only the nonce-bound revision files written by Bordeaux, rejects activation unless the robot is disabled, writes nonce-bound acknowledgments and state-changing status updates atomically, and never starts a listener, watcher, command, or network connection. The mailbox leaves a candidate in place if acknowledgment publication fails, so the next robot-loop poll can recover the persisted activation acknowledgment safely.

```java
var namespace = Path.of(BordeauxRobotStatusPublisher.PRODUCTION_DEPLOYMENT_NAMESPACE);
Files.createDirectories(namespace.resolve("inbox"));
Files.createDirectories(namespace.resolve("acks"));
var compatibility = new BordeauxRuntimeCompatibility(
    commandRegistry.catalogId(), commandRegistry.catalogHash(), "0.1.0",
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
