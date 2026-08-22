`BordeauxBindings.generatedCapabilities(...)`. The compile-checked
[`ExistingCommandProvider`](../src/main/java/dev/bordeaux/examples/commands/ExistingCommandProvider.java)
also shows a parameterized factory.

Do not expose an instance that WPILib has already composed into a command group.

## PathPlanner — 2026.1.2 API verified

After configuring `AutoBuilder` normally, build complex autos once at robot startup and expose the
resulting command. Parameterized pathfinding commands can still be created per invocation:

```java
public final class PathPlannerAutos {
    @BordeauxCommand(id = "pathplanner.center", label = "PathPlanner center auto")
    public final Command centerAuto;

    public PathPlannerAutos() {
        // Construct once at robot startup, after AutoBuilder.configure(...).
        centerAuto = AutoBuilder.buildAuto("Center Auto");
    }

    @BordeauxCommand(id = "pathplanner.to-pose", label = "Pathfind to pose")
    public Command pathfindToPose(
            @BordeauxParam(label = "X", unit = "m", min = "0", max = "17.6") double xM,
            @BordeauxParam(label = "Y", unit = "m", min = "0", max = "8.1") double yM,
            @BordeauxParam(label = "Heading", unit = "rad", min = "-3.142", max = "3.142") double headingRad) {
        var goal = new Pose2d(xM, yM, new Rotation2d(headingRad));
        var constraints = new PathConstraints(3.0, 4.0, Math.toRadians(540), Math.toRadians(720));
        return AutoBuilder.pathfindToPose(goal, constraints);
    }
}
```

PathPlanner warns that building complex autos may introduce significant delay, so do not call
`buildAuto` inside a supplier on the scheduler loop.

PathPlanner's `AutoBuilder` uses the same pose/reset/robot-relative speed/output seam as Bordeaux. Its
[`Build an Auto`](https://pathplanner.dev/pplib-build-an-auto.html) guide documents configuration,
and the official [`pathfinding` guide](https://pathplanner.dev/pplib-pathfinding.html) documents
`pathfindToPose`.

A wrapped PathPlanner command keeps PathPlanner's controller, feedforwards, event markers, and command
requirements. Do not also author the same PathPlanner event as a Bordeaux event around that wrapper.

PathPlanner can generate trajectories from waypoints, but current `BordeauxSample` cannot retain all
of `PathPlannerTrajectoryState`'s module feedforwards. Command wrapping is therefore functional and
lossless for existing behavior; converting it into an Aquitaine generated-trajectory node is not yet
lossless. See the official
[`PathPlannerTrajectoryState`](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/trajectory/PathPlannerTrajectoryState.java#L14-L40).

## Choreo — 2026.0.3 API verified

Expose the same top-level auto factory the robot already uses so its `AutoRoutine`, triggers, and
bindings stay intact:

```java
public final class ChoreoAutos {
    @BordeauxCommand(id = "choreo.pickup", label = "Follow Choreo pickup")
    public final Supplier<Command> pickup;

    public ChoreoAutos(Supplier<Command> existingPickupAutoFactory) {
        pickup = existingPickupAutoFactory;
    }
}
```

Pass the factory that builds/returns the robot's existing `AutoRoutine.cmd()` (or its complete composed
auto command), after all `AutoBindings` are installed. Keep the same Choreo warmup command the robot
schedules at startup. This preserves the controller, module-force handling, triggers, and bindings.

`autoFactory.trajectoryCmd("pickup")` is only appropriate for a deliberately binding-free standalone
trajectory. Choreo documents that this escape hatch does not invoke bindings added through
`AutoFactory.bind`; do not substitute it for an existing bound routine. Choreo documents both flows in
its
[`Auto Factory` guide](https://choreo.autos/choreolib/auto-factory/) and
[`AutoFactory` API](https://choreo.autos/api/choreolib/java/choreo/auto/AutoFactory.html).

Do not send `SwerveSample.getChassisSpeeds()` directly to Bordeaux's robot-relative output: Choreo's
X/Y sample velocity is field-relative. Let the Choreo controller calculate robot-relative output.
Direct conversion also loses Choreo's per-module force arrays with the current Bordeaux sample model.

## Aquitaine capabilities

Aquitaine is Bordeaux's own routine graph. A runtime document can contain:

| Aquitaine step | Robot-side behavior |
| --- | --- |
| Bordeaux path | Exposes a stable path ID to the follower |
| Command | Creates the generated, typed WPILib command and schedules it |
| Wait | Advances from the caller's monotonic periodic loop |
| Decision | Evaluates a generated `@BordeauxCondition` and selects one branch |
| Generated trajectory | Invokes a bounded provider off-thread, validates all samples, then exposes them |
| Validated fallback | Takes the compiled static branch only after generation failure |
| Safe stop | Calls the robot-owned stop callback exactly once when no validated path may run |

### Commands and sensor decisions

```java
@BordeauxCondition(id = "intake.has-piece", label = "Has game piece")
public boolean hasPiece() {
    return intake.hasPiece();
}

@BordeauxCommand(id = "score.release", label = "Release game piece")
public Command release() {
    return superstructure.releaseCommand();
}
```

Pass the provider to `BordeauxBindings.generatedCapabilities`. Unknown conditions, commands, or typed
arguments are rejected before the routine starts. Wait needs no Java method; `bordeaux.wait` is a
built-in typed step.

### Bounded custom path generation — processor-checked

[`SafeGeneratedTrajectoryProvider`](../src/main/java/dev/bordeaux/examples/generation/SafeGeneratedTrajectoryProvider.java)
and the full template's
[`DynamicPaths`](../../../examples/bordeaux-template-robot/src/main/java/frc/robot/paths/DynamicPaths.java)
show the complete annotation:

```java
@BordeauxTrajectoryGenerator(
    id = "paths.forward",
    preview = BordeauxTrajectoryPreview.RUNTIME_DYNAMIC,
    fallbackPolicy = BordeauxTrajectoryFallbackPolicy.SAFE_STOP_ONLY,
    timeoutMs = 40,
    maxSamples = 16,
    maxDurationS = 4,
    maxDistanceM = 2,
    maxVelocityMps = 2,
    maxAccelerationMps2 = 2,
    maxCentripetalAccelerationMps2 = 2,
    maxAngularVelocityRadps = 4,
    maxAngularAccelerationRadps2 = 8,
    minClearanceM = 0.2)
public BordeauxGeneratedTrajectory forward(
        BordeauxGenerationContext context,
        @BordeauxParam(min = "0.1", max = "2") double distanceM) {
    // Build samples beginning exactly at context's fused pose and velocity.
}
```

The method receives fused position, field velocity, angular velocity, field identity, and the robot's
hard limits. Bordeaux runs it on a bounded worker and releases nothing until the complete result passes
sample-count, time, distance, velocity, acceleration, centripetal, angular, field, swept-collision,
catalog, and continuity validation. A thrown error or timeout cannot leak a partial path.

The low-level runner reports `BordeauxRoutineProgress.Generating` while work is pending, then
`GeneratedTrajectory` with immutable validated samples. The caller follows those samples and calls
`completeGeneratedTrajectoryProgress(nodeId)` only after motion completes. This keeps generation
results and failures visible instead of converting them into a fire-and-forget command.

[`ContainedGeneratedRoutine`](../src/main/java/dev/bordeaux/examples/generation/ContainedGeneratedRoutine.java)
is the compile-checked construction template for `BordeauxRuntimeCompatibility`, robot-owned field and
swept-collision validators, the current fused-state supplier, and the safe-stop callback. Its catalog
identity comes directly from the generated capabilities; the field identity must match every supplied
generation context. Generation does not read `BordeauxDriveLimits` automatically: construct the
context's `BordeauxTrajectoryGeneratorLimits` from the same tested linear/angular velocity and
acceleration constants, plus explicit timeout, sample, duration, distance, centripetal, and clearance
bounds.

[`AquitaineRoutineLoop`](../src/main/java/dev/bordeaux/examples/generation/AquitaineRoutineLoop.java)
is the compile-checked caller lifecycle: it advances `Waiting`/`Generating`, hands static path IDs or
validated generated samples to one robot-owned follower, calls that follower each periodic loop,
reports completion back with the correct node ID, and stops it on safe-stop, completion, or close. The
follower implementation retains the drivetrain requirement and decides how a static path ID is loaded.

### Existing generated/pathfinding commands inside Aquitaine

A PathPlanner or Choreo pathfinding command may be an ordinary Aquitaine Command step today. It keeps
that library's controller and safety behavior, but Bordeaux cannot inspect its internal generated
samples. Aquitaine waits for each Command node to finish before exposing the next step.
Stopping or resetting the routine cancels its waiting command. Use an Aquitaine Generated Trajectory step only when the
provider returns Bordeaux samples for containment.

## Ownership rules

- One path-following command owns the drivetrain requirement at a time.
- A marker command should not require the drivetrain unless it is intentionally an interrupting
  transition.
- A wrapped PathPlanner/Choreo command owns its own markers and completion.
- Bordeaux path events use the same elapsed time/progress as the Bordeaux follower.
- Only events authored with `cancelOnPathEnd` are canceled automatically at path end.
- Stop and fallback behavior belongs to the robot and must be tested without vendor JNI.
