# Bordeaux Java support

This Java 17 bundle provides the robot-side half of Bordeaux commands for WPILib 2026.2.2. It uses stable IDs across the desktop/robot boundary; it never serializes Java objects, reflects over robot classes in the editor, or asks Bordeaux to instantiate subsystems.

New integration? Start with the [task-oriented Java guide](../docs/java/index.md). This README is the
compact reference for the complete shipped API and its invariants.

## Connect an existing WPILib command

The shortest integration is one annotation on the command a robot already uses:

```java
public final class RobotCommands {
    @BordeauxCommand(id = "intake.run", label = "Run intake")
    public final Command intakeCommand;

    public RobotCommands(Intake intake) {
        intakeCommand = intake.runCommand();
    }
}
```

The same instance can stay in existing teleop or autonomous wiring, such as
`controller.rightTrigger().whileTrue(commands.intakeCommand)`, when those entry points are mutually
exclusive. Pass the containing provider to `BordeauxBindings.generatedCapabilities(commands)`, and
the generated Bordeaux catalog and runtime bindings use that exact command too. WPILib gives one
command instance one shared lifecycle: scheduling it again while it is running is a no-op, and a
cancellation from either caller ends that same run.

Use a public final `Supplier<? extends Command>` field whenever teleop/auto and Bordeaux may overlap,
restart independently, or need separate cancellation. Each Bordeaux invocation then creates a fresh
command:

```java
@BordeauxCommand(id = "shooter.fire", label = "Fire")
public final Supplier<Command> fireCommand = shooter::fireCommand;
```

Existing public command factory methods still need only `@BordeauxCommand`. If an existing command
field should remain private, expose it through a small annotated public method instead. Command and
supplier fields are required to be final so the generated binding cannot silently change after the
catalog is compiled. As with ordinary WPILib scheduling, do not expose a command instance that has
already been composed into a command group; expose its factory or a supplier instead.

## Modules

- `annotations`: source-retained command, condition, parameter, and bounded trajectory-generator annotations.
- `processor`: an aggregating annotation processor that validates authored factories and predicates, then generates both `META-INF/bordeaux/commands.json` and direct-call `dev.bordeaux.generated.BordeauxGeneratedBindings`.
- `runtime`: bounded trajectory and routine execution, generated capabilities, exact argument conversion, complete motion references, and vendor-neutral WPILib drivetrain and vision seams.

The desktop app's **Install Java Support** action is the one supported integration path. It copies the runtime and processor jars into the linked robot project, adds one managed Gradle script, and creates the fixed `bordeauxCatalog` task. A separately published Gradle plugin is intentionally not maintained.

Factories must be public methods on public provider types and return `edu.wpi.first.wpilibj2.command.Command`. Existing commands may instead be public final `Command` or `Supplier<? extends Command>` fields. Non-static providers are explicit constructor dependencies of the generated bindings, keeping subsystem ownership in `RobotContainer`. Supported authored values are numeric/boolean primitives and wrappers, strings, enums, exact `long`/`BigInteger`/`BigDecimal`, arrays, collections, string-key maps, optionals, records, and public Jackson-deserializable objects with mutable public data fields plus a public no-argument constructor. `char`/`Character`, unsupported, recursive, or opaque shapes fail compilation.

Call `BordeauxBindings.generatedCapabilities(provider1, provider2, ...)` to construct the generated command, condition, and trajectory-generator capabilities. Provider order does not matter. This fixed bootstrap avoids importing a class emitted during the processor's final aggregation round, while the generated class still owns direct typed calls and compiled catalog identity. `generated(...)` remains available for command-only integrations.

See [`../examples/bordeaux-template-robot`](../examples/bordeaux-template-robot) for a complete
GradleRIO project. The [`examples`](examples) gallery has compile-checked vendor-neutral command,
drive, IMU, vision, generation, and simulation examples, plus hardware recipes for CTRE, YAGSL, REV
MAXSwerve, custom swerve, multiple IMUs and vision systems, PathPlanner, and Choreo. Every vendor
recipe states whether it is compile-checked, source/API-verified, or an integration sketch. The fixed
`bordeauxCatalog` task copies the processor resource to `build/bordeaux/catalog-v1.json`, which is the
only generated project file the app reads.

## Catalog identity

Set `-Abordeaux.catalogId=<team-stable-id>` on `JavaCompile`; otherwise the first provider type is the fallback ID. The generated catalog uses `schemaVersion: "1.3"`, `supportVersion: "0.4.0"`, and a deterministic `catalogHash`. It includes the closed `bordeaux.wait` built-in and any strictly bounded `@BordeauxTrajectoryGenerator` descriptors. Both the ID and hash are compiled into `BordeauxGeneratedBindings` and its capabilities.

The hash is `sha256:` plus lowercase SHA-256 of UTF-8 canonical JSON for `{builtIns,commands,conditions,trajectoryGenerators}`. Capability arrays are sorted by ID, authored inputs by name, and canonical JSON recursively sorts every object key lexicographically. A `bordeaux-trajectory/1.0` document carries the same ID and hash in `catalog`; capability runners reject either mismatch and any unknown condition before scheduling anything.

## Connect an existing drivetrain and estimator

`BordeauxDriveAdapter` sits above swerve module, motor-controller, and IMU vendors. A working CTRE,
YAGSL, REV, or custom drivetrain can expose its corrected pose, measured robot-relative speeds, and
robot-relative output without Bordeaux importing that vendor's API:

```java
var drive = BordeauxDriveAdapter.forSubsystem(drivetrain)
    .state(drivetrain::getBordeauxDriveState)
    .output(drivetrain::driveRobotRelative)
    .resetPose(drivetrain::resetPose)
    .visionMeasurement(observation -> drivetrain.addVisionMeasurement(
        observation.fieldPose(), observation.captureTimestampS(),
        VecBuilder.fill(observation.xStdDevM(), observation.yStdDevM(),
            observation.headingStdDevRad())))
    .stop(drivetrain::stop)
    .limits(new BordeauxDriveLimits(4.8, 7.0, 9.0, 18.0))
    .build();
```

`getBordeauxDriveState()` returns one robot-owned snapshot containing corrected pose, measured speeds,
and the source observation time in FPGA seconds. Build it from the same cached estimator update;
do not stamp older sensor data with the current loop time. Vision is normalized as
`BordeauxVisionObservation`: source ID, field pose, FPGA capture timestamp, and explicit X/Y/heading
standard deviations. If the team-owned estimator is already fused—as with many CTRE and YAGSL
drivetrains—it remains the single estimator owner. The vision callback is optional when the robot does
not use Bordeaux vision sources, and unsupported delivery fails clearly instead of discarding a
measurement.

Every drive request is checked for finite values and the robot-owned linear/angular velocity limits
before it reaches the subsystem. Acceleration limits are exposed to callers and the staged
command-returning follower; the current adapter does not infer acceleration between calls, and
generated-trajectory containment reads the separate limits supplied through
`BordeauxGenerationContext.safetyLimits()`. Map both from the same tested robot constants.
Deterministic simulation supplies the same timestamped state contract as hardware.

## Runtime lifecycle

Construct the exact `BordeauxRuntimeCompatibility` from the generated catalog identity plus the
robot's compiled field pack, open the deployed file, and load with
`BordeauxTrajectoryReader.read(input, pathIdOrName, compatibility)`. This caps acquisition at 16 MiB
and validates the catalog, field identity, every exported path, and every deployable routine branch
before selecting the path. The lower-level two-argument `read(input, selector)` overload is for an
already-validated input and does not perform that whole-document/field preflight itself. Construct
`BordeauxEventRunner` from generated capabilities, then call
`periodic(elapsedS, measuredFraction)` from the normal robot loop. Time events
use elapsed path time; position events use monotonic measured progress even on a time-followed
section. Optional condition IDs are preflighted before the path starts, and repeated events catch up
through their authored end window without loop-jitter skips. Event IDs are required and duplicate
IDs are rejected. Generated bindings reject missing, unknown, malformed, or out-of-range arguments
again on the robot before creating a command.

For trajectory references, construct `BordeauxReferenceFollower` from that selected path and call `update(dtS, measuredXM, measuredYM)` each robot loop. Time sections advance on a section-local clock. Position sections advance monotonically from the measured field pose, use a short sample lookahead, and do not complete until the robot reaches the section endpoint. The returned `BordeauxSample` is a reference for the team's drivetrain controller; this low-level class does not construct a drivetrain or own odometry.

The low-level follower remains available during migration and still leaves controller lifecycle to the
team. Its samples now preserve authored acceleration, angular velocity, and curvature in addition to
pose and linear velocity. They also carry a travel heading separate from the robot's physical heading,
so holonomic translation direction is never inferred from where the robot is facing. `BordeauxDrive`
is the stable adapter seam reserved for the staged command-returning holonomic runtime; no current
production command consumes it yet. Existing drivetrains still do not need to expose individual
modules to use the seam or the compile-checked integration examples.

For a multi-path autonomous routine, load the bounded stream with
`BordeauxTrajectoryReader.readWithRoutine(input, pathIdOrName, compatibility)`, then construct
`BordeauxRoutineRunner` with that document and generated capabilities. Routines without a wait or
generated trajectory can use `start()` and `completePath(...)`, which return the next stable path ID
or an empty result at completion. Other routines use `startProgress()`,
`completePathProgress(...)`, `completeGeneratedTrajectoryProgress(...)`, and `periodic()` from the
normal robot loop. Progress is explicit: `Path` and `GeneratedTrajectory` are references the
drivetrain may follow, `Waiting` and `Generating` require another `periodic()` call, and
`SafeStopped` and `Complete` are terminal. Every decision and command, including those in a
generated fallback, is preflighted before start.

Generated trajectories additionally require `BordeauxGeneratedTrajectorySafety`. Supply the exact compiled `BordeauxRuntimeCompatibility`, a `BordeauxGenerationContext` supplier with the current field pose, field-relative X/Y velocity, angular velocity, and robot-owned limits, field and swept-segment collision validators, and the drivetrain's safe-stop callback. The runner executes each team generator on a fresh daemon worker, takes the stricter descriptor/robot limit in every dimension, and releases no samples until the whole result is finite, ordered, duration/distance/velocity/acceleration bounded, field-valid, and collision-free. It derives translational acceleration and path curvature from XY samples rather than trusting declared velocity or robot heading. Generated bindings also preflight every typed fallback argument without invoking a team command factory. A deadline, thrown error, invalid sample, or validator failure takes the catalog-declared validated static fallback; otherwise the safe-stop callback runs exactly once. Timed-out work is interrupted and never reused or exposed.
The released generated samples also use field-velocity direction, velocity, acceleration, angular
velocity, and curvature canonicalized from the validated geometry and timing, so generator-declared
feedforward cannot contradict the containment checks. A zero-distance sample cannot hide a moving
direction reversal.

On `BordeauxEventRunner`, `endPath()`, `stop()`, `close()`, and `reset()` cancel only commands from
events that set `cancelOnPathEnd: true`; ordinary commands scheduled by an event are left alone.
`reset()` also clears exactly-once state for another run, and elapsed time cannot move backward
without a reset. Aquitaine Command nodes are different: `BordeauxRoutineRunner` schedules and
continues, and its `stop()`, `reset()`, and `close()` methods do not cancel those team-owned commands.

## Optional Bordeaux push mailbox

Teams that opt into desktop-to-robot pushes provision `/home/lvuser/deploy/bordeaux/push-v1` with `inbox` and `acks` subdirectories, construct `BordeauxRevisionService` with their disabled supplier and compiled compatibility, then construct `BordeauxRobotMailboxService`. Call `periodic()` from `robotPeriodic` so `status.json` follows enabled transitions immediately; unchanged loops do not rewrite it. It accepts only the nonce-bound revision files written by Bordeaux, rejects activation unless the robot is disabled, writes nonce-bound acknowledgments and state-changing status updates atomically, and never starts a listener, watcher, command, or network connection. The mailbox leaves a candidate in place if acknowledgment publication fails, so the next robot-loop poll can recover the persisted activation acknowledgment safely.

The same mailbox accepts only strict nonce-bound `*.bordeaux-retention.json` controls for explicit disabled-only rollback and pin actions. Runtime state retains the five newest accepted revisions plus one older pinned revision, reports their exact retained/missing/pinned state in `status.json`, and only ever removes a digest-derived immutable payload after its replacement manifest is durable. It does not enumerate or recursively delete revision storage, so files from an older or unknown manifest are never swept up by retention cleanup.

The mailbox also advertises `activeRevisionRead: "bordeaux-active-revision/1.0"` in `status.json` and publishes the exact active trajectory payload as `active-trajectory.json` in the fixed mailbox namespace. This bounded, atomic export is independent of the service’s private/configurable revision-storage directory. Desktop reads verify its hash and derived revision identity against status before and after reading; missing/corrupt storage removes the capability and reports diagnostics. The read capability does not add a network listener or change disabled-only activation.

Selected desktop path updates preserve all other records by composing and validating a complete snapshot before using the existing revision protocol. New desktop deployment payloads include optional `deploymentContext` metadata binding the robot configuration; the Java trajectory reader continues to accept these payloads. Legacy baselines need an explicitly reviewed full-project replacement before selective composition. Updating a path used by the preserved routine changes its motion, although its routine graph is unchanged.


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
