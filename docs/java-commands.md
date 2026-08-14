# Java commands

Bordeaux uses a generated, versioned JSON contract between the desktop editor and robot code. The editor never loads robot classes. Source discovery is only a preview; only commands emitted by the annotation processor are exportable.

For a project you can link immediately, start with [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot). It includes a complete GradleRIO robot, four annotated commands, generated-binding wiring, a pre-authored Bordeaux project, trajectory loading, and simulation-safe lifecycle handling.

## Desktop workflow

1. After a tagged Java release has published the `java-maven` branch, install `https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven/BordeauxLib2026.json` through WPILib's **Manage Vendor Libraries** command or run `./gradlew vendordep --url=https://raw.githubusercontent.com/Zw96042/bordeaux/java-maven/BordeauxLib2026.json` in the robot project.
2. Choose **Java > Link Robot Project…** and select that GradleRIO Java project.
3. Choose **Install or Update Support…**. Bordeaux detects a matching vendordep, previews the managed catalog configuration, preserves a one-time build-file backup, and does not edit `RobotContainer` or deploy code. Without a matching vendordep, it previews an offline installation using the runtime and processor jars bundled with the app.
4. Add `@BordeauxCommand` and `@BordeauxParam` annotations in the robot project.
5. Choose **Build Command Catalog…**. After an explicit trust prompt, Bordeaux runs only `./gradlew bordeauxCatalog --no-daemon --console=plain`.
6. Add an event marker or an Auto-tab Command step, select a generated command, and author its typed arguments.
7. Export Java JSON. Linked-project export writes `src/main/deploy/bordeaux/<project>.bordeaux.json`; GradleRIO deploys it with the rest of `src/main/deploy`.

The generated catalog is `build/bordeaux/catalog-v1.json`. Bordeaux rejects malformed catalogs, unsupported runtime schemas, hash mismatches, unresolved/source-only commands, and invocation arguments that do not match the generated schema.

## Robot workflow

The installed `.bordeaux/INTEGRATION.md` contains the project-local handoff. Complete examples live in [`../java/examples`](../java/examples), and the Java API and lifecycle are documented in [`../java/README.md`](../java/README.md).

In brief, call `BordeauxBindings.generated(...)` with the team-owned command-provider instances and load an exported path through `BordeauxTrajectoryReader`; use `readWithRoutine(...)` when running the exported Auto-tab routine. `BordeauxPathRunner.update(dtS, measuredXM, measuredYM, measuredFraction)` returns the next drivetrain reference and schedules time- or position-triggered annotated commands with their exported typed parameters. Pass actual monotonic progress as `measuredFraction`, not the lookahead reference fraction. Register sensor predicates under stable IDs with `BordeauxConditionRegistry`. For Auto-tab routines, use `BordeauxRoutineRunner.startTransition()` and `completePathTransition(id)`: run the path carried by `PATH_ACTIVE`, call `periodic()` once per robot loop during `WAITING_FOR_COMMAND`, and stop at `COMPLETE`. Between-path commands finish sequentially before the next path is exposed. The legacy path-only `start()` and `completePath(id)` methods throw when they encounter a command wait, so integrations with routine commands must use the transition API. Call `BordeauxPathRunner.end()` when a path ends; only event invocations authored with **Cancel at path end** are canceled.

Generated bindings include side-effect-free argument validators automatically. Hand-built `BordeauxCommandRegistry` instances used with event or routine runners must use the four-argument `register(id, parameterNames, validator, factory)` overload; the validator should perform the same `BordeauxArguments` reads as the factory without creating commands or touching robot state. The legacy three-argument overload supports direct `registry.create(...)` calls only and is rejected during autonomous preflight.

## Contract invariants

- Catalog schema: `1.0`; trajectory schema: `bordeaux-trajectory/1.0`; support version: `0.1.0`.
- The trajectory carries the stable catalog ID and semantic command hash compiled into the robot registry; both must match before an event can run.
- `catalogHash` is SHA-256 of canonical JSON for the generated `commands` array and must match the hash compiled into the robot registry.
- Exact Java integers and decimals cross the JSON boundary as strings.
- Event IDs are stable and unique within a path.
- Bordeaux does not run Gradle until the user accepts the trust prompt, and it never performs robot deployment.
