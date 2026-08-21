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
