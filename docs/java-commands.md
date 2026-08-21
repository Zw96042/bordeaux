# Java commands

Bordeaux uses a generated, versioned JSON contract between the desktop editor and robot code. The editor never loads robot classes. Source discovery is only a preview; only commands emitted by the annotation processor are exportable.

For a guided setup and migration path, start at the [Java documentation home](java/index.md). This
page records the desktop/robot contract and exact schema invariants.

For a project you can link immediately, start with
[`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot). It includes a complete
GradleRIO robot, method/field/supplier commands, a processor-checked generated-path provider, generated-binding
wiring, a pre-authored Bordeaux project, trajectory loading, and simulation-safe lifecycle handling.
The [`../java/examples`](../java/examples/README.md) gallery adds hardware, estimator, vision,
PathPlanner, Choreo, Aquitaine, tuning, and simulation recipes.

## Desktop workflow

1. Choose **Java > Link Robot Project…** and select a GradleRIO Java project.
2. Choose **Install or Update Support…**. Bordeaux previews the managed files, preserves a one-time build-file backup, and does not edit `RobotContainer` or deploy code.
3. Add `@BordeauxCommand`, `@BordeauxCondition`, and `@BordeauxParam` annotations in the robot project.
4. Choose **Build Command Catalog…**. After an explicit trust prompt, Bordeaux runs only `./gradlew bordeauxCatalog --no-daemon --console=plain`.
5. Add an event marker or an Auto-tab Command step, select a generated command, and author its typed arguments.
6. Export Java JSON. Linked-project export writes `src/main/deploy/bordeaux/<project>.bordeaux.json`; GradleRIO deploys it with the rest of `src/main/deploy`.

The generated catalog is `build/bordeaux/catalog-v1.json`. Bordeaux rejects malformed catalogs, unsupported runtime schemas, hash mismatches, unresolved/source-only commands, and invocation arguments that do not match the generated schema.

## Robot workflow

The installed `.bordeaux/INTEGRATION.md` contains the project-local handoff. Complete examples live in [`../java/examples`](../java/examples), and the Java API and lifecycle are documented in [`../java/README.md`](../java/README.md).

In brief, call `BordeauxBindings.generatedCapabilities(...)` with the team-owned providers, build
`BordeauxRuntimeCompatibility` from that catalog identity and the robot's compiled field pack, and
load the exported stream through the bounded, validated `BordeauxTrajectoryReader.read(...)`
overload; use the
validated `readWithRoutine(...)` overload for an exported Auto-tab routine. This preflights field and
catalog identity plus every exported path/branch before selection. `BordeauxEventRunner` preflights
event conditions and validates a command invocation when it becomes due. `BordeauxRoutineRunner`
preflights every reachable command and condition; its contained generated-trajectory constructor also
preflights generator IDs, fallback policy, and fallback arguments. Routines with Wait or
runtime-generated trajectories use the caller-driven progress API; generated trajectories also
require robot-owned limits, current pose, field/collision validators, and a safe-stop callback through
`BordeauxGeneratedTrajectorySafety`. Call `endPath()` when a path ends; only event invocations
authored with **Cancel at path end** are canceled.

## Contract invariants

- Catalog schema: `1.3`; trajectory schema: `bordeaux-trajectory/1.0`; support version: `0.4.0`.
- The trajectory carries the stable catalog ID and semantic capability hash compiled into the robot capabilities; both must match before an event or routine can run.
- `catalogHash` is SHA-256 of canonical JSON for `{builtIns,commands,conditions,trajectoryGenerators}`; the built-in list contains the bounded `bordeaux.wait` contract, and every capability array is sorted by stable ID.
- Exact Java integers and decimals cross the JSON boundary as strings.
- Event IDs are stable and unique across the complete export.
- Bordeaux does not run Gradle until the user accepts the trust prompt, and it never performs robot deployment.
