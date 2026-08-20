```

Its `MotionFollower` starts static path IDs or generated sample lists, advances motion once per loop,
reports completion to the matching `completePathProgress(...)` or
`completeGeneratedTrajectoryProgress(...)` method, and stops on safe stop, completion, or close.
Static path loading, controller output, path events, and the drivetrain requirement remain the
follower's responsibility.

The command-returning runtime that will own this bridge and return one holonomic WPILib `Command` is
**staged, not shipped**. Current robot code should use `AquitaineRoutineLoop`, a team-owned command
around that loop, or an existing PathPlanner/Choreo command exposed as an Aquitaine command step.

### Command nodes finish before the next step

An Aquitaine Command node creates and schedules its WPILib command, then reports `CommandWaiting`.
Call `periodic()` once per robot loop; the next command or path is exposed only after the scheduler
reports completion. `stop()`, `reset()`, and `close()` cancel the waiting command. A custom scheduler
must implement `isScheduled(...)` consistently with its scheduling and cancellation behavior.

Transition API integrations use `startTransition()`, `completePathTransition(...)`, and
`periodicTransition()`. Migrate the former routine `periodic()` call to `periodicTransition()` when
expecting a `Transition`; `periodic()` returns the richer `BordeauxRoutineProgress`.
WPILib requirements and interruption rules still apply. Path events retain their independent
**Cancel at path end** policy.

## Author a bounded generator

The processor recognizes public methods annotated with `@BordeauxTrajectoryGenerator`. A generator
receives current robot/field state through
[`BordeauxGenerationContext`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxGenerationContext.java)
and returns all samples at once:

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
    // Return sequential BordeauxSample values beginning at context's pose.
}
```

Use the processor-checked
[`SafeGeneratedTrajectoryProvider`](../../java/examples/src/main/java/dev/bordeaux/examples/generation/SafeGeneratedTrajectoryProvider.java)
or the template's tested
[`DynamicPaths`](../../examples/bordeaux-template-robot/src/main/java/frc/robot/paths/DynamicPaths.java)
as the canonical starting point.

The context includes fused X/Y/heading, field-relative X/Y velocity, angular velocity, field identity,
and robot-owned generator limits. The simple constructor that omits velocity represents a robot
starting from rest. A generator intended for a moving start must make its first segment continuous
with the injected velocities.

## What containment guarantees

The runtime invokes each generator on a fresh daemon worker and takes the stricter value between its
annotation descriptor and the robot's
[`BordeauxTrajectoryGeneratorLimits`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxTrajectoryGeneratorLimits.java).
It releases no samples until the complete result passes:

- deadline and sample-count limits;
- finite sequential indexes and monotonic time, distance, and fraction;
- current-pose start within the runtime's `1e-6` metre/radian tolerance, and final fraction;
- duration, geometric distance, linear velocity, and acceleration limits;
- angular velocity, angular acceleration, curvature, and centripetal limits;
- field containment and swept-segment collision checks; and
- moving-start continuity, including rejection of a hidden reversal in a zero-distance segment.

Generated declarations are treated as untrusted. The executor derives released velocity,
acceleration, angular velocity, curvature, and travel heading from validated geometry and timing. It
does not trust generator-declared feedforward values that could disagree with the containment checks.

A timeout, thrown error, null result, invalid sample, or validator failure produces the cataloged
validated static fallback. If no validated branch is allowed, Bordeaux runs the robot-owned safe-stop
callback exactly once. Timed-out work is interrupted and its later result is never exposed.

## Static and generated following

[`BordeauxSample`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxSample.java) carries
field pose, signed path speed, acceleration, angular velocity, curvature, and a travel heading that is
separate from the robot's physical heading. `fieldVelocityXMps()` and `fieldVelocityYMps()` derive
translation from signed speed and that travel heading; a negative speed reverses the resulting field
velocity.

[`BordeauxReferenceFollower`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxReferenceFollower.java)
is the current low-level reference selector. It advances time-followed sections from section-local
elapsed time and position-followed sections monotonically from measured X/Y with a short lookahead.
It returns references; the team controller still calculates drivetrain output and owns command
lifecycle.

Wrapping a top-level PathPlanner or Choreo auto as an ordinary `Command` or `Supplier<Command>`
capability preserves that command's controller, feedforwards, events, and requirements. An Aquitaine
Command node still uses the fire-and-continue lifecycle above: make such an auto a deliberate
terminal action or gate later motion through team-owned completion state. Converting its trajectory
into `BordeauxSample` is not currently lossless because the Bordeaux sample model does not retain
module force/feedforward data. The canonical
[path tools and Aquitaine guide](../../java/examples/hardware/path-tools-and-aquitaine.md) documents
the supported wrapping patterns and ownership rules.

## Required failure tests

Test every generator with every start state its contract supports. A moving-start generator needs
valid moving-context and continuity tests; an intentionally stopped-only generator must reject
nontrivial motion. Also cover field edges, obstacle clearance, maximum sample count, timeout,
exception, NaN, duplicate time, backward distance, excessive linear/angular/centripetal dynamics,
fallback, safe stop, and interruption. Exercise every Aquitaine decision branch and verify that
commands requiring the drivetrain do not accidentally interrupt an active follower.

The [Java example gallery](../../java/examples/README.md) links the containment tests and the complete
Aquitaine lifecycle. The [template robot](../../examples/bordeaux-template-robot/README.md) catalogs a
generator but intentionally does not claim to run it without real robot limits, fused state, field
validators, and a follower.
