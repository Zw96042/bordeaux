# Bordeaux Java support

This Java 17 bundle provides the robot-side half of Bordeaux commands for WPILib 2026.2.2. It uses stable IDs across the desktop/robot boundary; it never serializes Java objects, reflects over robot classes in the editor, or asks Bordeaux to instantiate subsystems.

## Modules

- `annotations`: source-retained `@BordeauxCommand` and `@BordeauxParam` annotations.
- `processor`: an aggregating annotation processor that validates authored factories and generates both `META-INF/bordeaux/commands.json` and direct-call `dev.bordeaux.generated.BordeauxGeneratedBindings`.
- `runtime`: a bounded `bordeaux-trajectory/1.0` reader, generated registry API, exact argument conversion, and a jitter-safe WPILib command event runner.
- `vendor`: the published `dev.bordeaux:bordeaux-java` artifact, combining those three modules so one vendordep version supplies both robot runtime and annotation processing.

After the first `java-v0.1.0` tag publishes the `java-maven` branch, install the vendordep in a GradleRIO project with WPILib's **Manage Vendor Libraries** command, using this URL:

```text
https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven/BordeauxLib2026.json
```

The equivalent command-line installation is:

```text
./gradlew vendordep --url=https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven/BordeauxLib2026.json
```

Then link the project in Bordeaux and choose **Install Java Support**. The app recognizes the vendordep and adds a managed Gradle script that enables annotation processing and creates the fixed `bordeauxCatalog` task. If a matching vendordep is absent, the same action offers an offline fallback using the runtime and processor jars bundled with the desktop app. A separate Gradle plugin is intentionally not maintained.

Factories must be public methods on public provider types and return `edu.wpi.first.wpilibj2.command.Command`. Non-static providers are explicit constructor dependencies of the generated bindings, keeping subsystem ownership in `RobotContainer`. Supported authored values are numeric/boolean primitives and wrappers, strings, enums, exact `long`/`BigInteger`/`BigDecimal`, arrays, collections, string-key maps, optionals, records, and public Jackson-deserializable objects with mutable public data fields plus a public no-argument constructor. `char`/`Character`, unsupported, recursive, or opaque shapes fail compilation.

Call `BordeauxBindings.generated(provider1, provider2, ...)` to construct the generated registry. Provider order does not matter. This fixed bootstrap avoids importing a class emitted during the processor's final aggregation round, while the generated class still owns direct typed calls and compiled catalog identity.

If a test or custom integration builds `BordeauxCommandRegistry` by hand, use the four-argument `register` overload and repeat the factory's argument reads in a side-effect-free validator:

```java
.register("score", Set.of("count"),
    args -> args.requireLong("count", "1", "5"),
    args -> score(args.requireLong("count", "1", "5")))
```

Event and routine runners call the validator during construction so malformed autonomous arguments fail before motion or command creation. The older three-argument overload remains available for direct `registry.create(...)` use, but registries containing those entries are deliberately rejected by the runners because their factories cannot be safely invoked during preflight.

See [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot) for a complete GradleRIO project and [`examples`](examples) for integration snippets. The fixed `bordeauxCatalog` task copies the processor resource to `build/bordeaux/catalog-v1.json`, which is the only generated project file the app reads.

## Catalog identity

Set `-Abordeaux.catalogId=<team-stable-id>` on `JavaCompile`; otherwise the first provider type is the fallback ID. The generated catalog uses `schemaVersion: "1.0"`, `supportVersion: "0.1.0"`, and a deterministic `catalogHash`. Both the ID and hash are compiled into `BordeauxGeneratedBindings` and its registry.

The hash is `sha256:` plus lowercase SHA-256 of UTF-8 canonical JSON for the `commands` array only. Commands are sorted by ID and parameters by name. Canonical JSON recursively sorts every object key lexicographically, preserves array order, uses normal JSON string escaping, and contains no insignificant whitespace. A `bordeaux-trajectory/1.0` document carries the same ID and hash in `catalog`; `BordeauxEventRunner` rejects either mismatch before scheduling anything.

## Runtime lifecycle

Load one selected path with `BordeauxTrajectoryReader.read(input, pathIdOrName)`, construct `BordeauxEventRunner`, then call `periodic(elapsedS, measuredFraction)` from the normal robot loop. Time events use elapsed path time; position events use monotonic measured progress even on a time-followed section. Optional condition IDs are resolved through `BordeauxConditionRegistry`, and repeated events catch up through their authored end window without loop-jitter skips. Catch-up is limited to 64 due invocations per update; a larger backlog fails before event state, conditions, factories, or the scheduler are touched. Event IDs are required and duplicate IDs are rejected. `readWithRoutine(...)` retains the bounded event metadata for every path referenced anywhere in the routine tree, and `BordeauxRoutineRunner` validates those events along with every routine command and decision before the first path starts. This preflight validates command IDs, condition IDs, and arguments without invoking command factories or evaluating sensor conditions; each path's `BordeauxEventRunner` still schedules only that selected path's events. Manually constructed multi-path documents must likewise provide `routinePathEvents` for every referenced path; missing metadata is rejected before `startTransition()`.

For normal robot integration, construct `BordeauxPathRunner` from the selected path and generated command registry. Call `update(dtS, measuredXM, measuredYM, measuredFraction)` once per robot loop, then pass the returned `BordeauxSample` to the team's drivetrain controller. This single update keeps reference following and annotated command events on one clock. `measuredFraction` must be actual monotonic robot progress; never substitute the returned lookahead sample's fraction, because that would fire position events early. Call `end()` from the owning WPILib command's `end(...)` method and stop drivetrain outputs there.

`BordeauxReferenceFollower` and `BordeauxEventRunner` remain available separately for custom integrations. Time sections advance on a section-local clock. Position sections advance monotonically from the measured field pose, use a short sample lookahead, and do not complete until the robot reaches the section endpoint. The runtime deliberately does not own drivetrain construction, odometry, controller gains, settling policy, or subsystem requirements.

For a multi-path autonomous routine, load the document with `BordeauxTrajectoryReader.readWithRoutine(...)`, then construct `BordeauxRoutineRunner` with that document, command registry, and condition registry. Use `startTransition()` and, after each trajectory finishes, `completePathTransition(id)`. A `PATH_ACTIVE` transition carries the next stable path ID. A `WAITING_FOR_COMMAND` transition carries no path: call `periodic()` once per robot loop until the command finishes; consecutive between-path commands are scheduled and awaited one at a time. `COMPLETE` means the routine is done. The legacy path-only `start()` and `completePath(id)` methods return an empty result only for true completion; if a routine reaches a command, they throw `BordeauxRuntimeException` rather than silently presenting the wait as completion. Integrations that run routine command nodes must migrate to `startTransition()`, `completePathTransition(id)`, and `periodic()`. `reset()`, `stop()`, and `close()` cancel a waiting routine command. A custom scheduler not backed by WPILib's global `CommandScheduler` must override `Scheduler.isScheduled(...)`. This explicit routine API rejects simulation-only function steps, unknown path references, duplicate node IDs, and oversized trees, while the selected-path `read(...)` API remains compatible with older 1.0 exports containing simulation-only routine metadata.

On `BordeauxEventRunner`, `endPath()`, `stop()`, `close()`, and `reset()` cancel only commands from events that set `cancelOnPathEnd: true`; ordinary commands scheduled by an event are left alone. `reset()` also clears exactly-once state for another run. Elapsed time cannot move backward without a reset.

## Build and test

From this directory:

```text
./gradlew test
./gradlew build
```

`build` also writes the two installer artifacts expected by the desktop app: `dist/bordeaux-runtime.jar` and `dist/bordeaux-processor.jar`. Both include the source-retained annotation classes so the app's two-file Gradle installation works without a third annotations artifact; Jackson and WPILib remain supplied by the GradleRIO project.

Run the publishable bundle and clean-consumer checks from the repository root:

```text
npm run build:java-release
npm run test:java-vendordep
```

The release bundle contains the WPILib vendordep, a persistent Maven repository, source jars, checksums, and flat artifacts under `java/build/release`. Release maintenance is documented in [`../docs/java-release.md`](../docs/java-release.md).

The only non-WPILib library declared directly is Jackson Databind 2.18.3, which WPILib already uses for JSON data. The explicit API gives the standalone runtime deterministic resource-limit behavior. The processor remains dependency-free, and top-level `Optional<T>` arguments are converted without an extra Jackson module.
