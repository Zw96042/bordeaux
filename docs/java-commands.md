# Java commands

Bordeaux uses a generated, versioned JSON contract between the desktop editor and robot code. The editor never loads robot classes. Source discovery is only a preview; only commands emitted by the annotation processor are exportable.

For a project you can link immediately, start with [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot). It includes a complete GradleRIO robot, four annotated commands, generated-binding wiring, a pre-authored Bordeaux project, trajectory loading, and simulation-safe lifecycle handling.

## Desktop workflow

1. Choose **Java > Link Robot Project…** and select a GradleRIO Java project.
2. Choose **Install or Update Support…**. Bordeaux previews the managed files, preserves a one-time build-file backup, and does not edit `RobotContainer` or deploy code.
3. Add `@BordeauxCommand` and `@BordeauxParam` annotations in the robot project.
4. Choose **Build Command Catalog…**. After an explicit trust prompt, Bordeaux runs only `./gradlew bordeauxCatalog --no-daemon --console=plain`.
5. Add an event marker, select a generated command, and author its typed arguments.
6. Export Java JSON. Linked-project export writes `src/main/deploy/bordeaux/<project>.bordeaux.json`; GradleRIO deploys it with the rest of `src/main/deploy`.

The generated catalog is `build/bordeaux/catalog-v1.json`. Bordeaux rejects malformed catalogs, unsupported runtime schemas, hash mismatches, unresolved/source-only commands, and invocation arguments that do not match the generated schema.

## Robot workflow

The installed `.bordeaux/INTEGRATION.md` contains the project-local handoff. Complete examples live in [`../java/examples`](../java/examples), and the Java API and lifecycle are documented in [`../java/README.md`](../java/README.md).

In brief, call `BordeauxBindings.generated(...)` with the team-owned command-provider instances, load an exported path through `BordeauxTrajectoryReader`, create a `BordeauxEventRunner`, and call `periodic(elapsedSeconds)` beside the path follower. The bootstrap loads the final-round generated direct bindings without making ordinary robot source depend on a not-yet-generated class during a clean compile. The runner catches up events missed by loop jitter and schedules each stable event ID once per run. Call `endPath()` when the path ends; only invocations authored with **Cancel at path end** are canceled.

## Contract invariants

- Catalog schema: `1.0`; trajectory schema: `bordeaux-trajectory/1.0`; support version: `0.1.0`.
- The trajectory carries the stable catalog ID and semantic command hash compiled into the robot registry; both must match before an event can run.
- `catalogHash` is SHA-256 of canonical JSON for the generated `commands` array and must match the hash compiled into the robot registry.
- Exact Java integers and decimals cross the JSON boundary as strings.
- Event IDs are stable and unique within a path.
- Bordeaux does not run Gradle until the user accepts the trust prompt, and it never performs robot deployment.
