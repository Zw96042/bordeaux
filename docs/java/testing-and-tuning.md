- optional vision support is reported honestly; and
- stop produces the robot's real zero/idle behavior.

After vendor-free tests pass, run the selected vendor simulator and then test at reduced limits on
blocks. The [drivetrain guide](../../java/examples/hardware/drivetrains.md) records the simulator and
adapter expectations for CTRE, YAGSL, REV MAXSwerve, and custom WPILib swerve.

## Make time deterministic

Do not use wall-clock sleeps to advance controller or routine time. Step a fake FPGA clock
explicitly. A bounded poll or yield may still be needed to let an asynchronous generator worker run,
but assertions should depend on progress state and the fake deadline rather than elapsed wall time.
Current runtime classes already expose deterministic seams:

- `BordeauxReferenceFollower.update(dtS, measuredXM, measuredYM)` accepts the loop interval and
  measured position directly.
- `BordeauxEventRunner` accepts an explicit scheduler, while `periodic(elapsedS, measuredFraction)`
  accepts caller-controlled progress.
- `BordeauxRoutineRunner` has constructors accepting an explicit scheduler and monotonic
  `DoubleSupplier` clock.
- `AquitaineRoutineLoop.MotionFollower` is a small fakeable interface for static and generated
  motion completion.

Cover time jitter, repeated-event catch-up, monotonic position progress, section transitions, clock
regression, reset, interruption, and command cancellation ownership. The authoritative current tests
are under [`java/runtime/src/test`](../../java/runtime/src/test) and
[`java/examples/src/test`](../../java/examples/src/test).

Generated-path workers are asynchronous, but their observable outcomes are deterministic:
`Generating`, validated immutable samples, the next progress selected by a validated fallback, or
`SafeStopped`. There is no separate fallback progress type. Assert the progress and stop/fallback
side effect; never inspect or depend on the generator thread itself.

## Tune in three layers

### 1. Hardware control

Tune wheel radius, gear ratios, encoder offsets, inversion, current limits, steer feedback, drive
velocity feedback/feedforward, and characterization in the vendor or team drivetrain. Verify that
measured chassis speed comes from actual module states and that a constant robot-relative request is
tracked before tuning any path feedback.

[`BordeauxDriveLimits`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveLimits.java)
contains positive finite linear/angular velocity and acceleration limits:

```java
var limits = new BordeauxDriveLimits(
    4.8,   // m/s
    7.0,   // m/s^2
    9.0,   // rad/s
    18.0); // rad/s^2
```

The current adapter enforces velocity and finiteness at the chassis output seam. It does not replace
motor current limiting, module-level slew/torque control, or wheel-speed desaturation. Begin below
theoretical free speed and raise limits from measured logs.

### 2. Localization

Tune odometry process assumptions and each vision source independently. Record raw camera pose,
capture time, estimator pose, tag count/geometry, distance, ambiguity, and robot angular speed. Use
observed residuals to select positive X/Y/heading standard deviations; they are not arbitrary trust
percentages.

Replay a fast turn to validate latency. A correction applied at the wrong point in history usually
indicates a bad timestamp epoch or guessed latency. Test duplicate, delayed, out-of-field, disconnected,
and translation-only observations before combining cameras. The
[vision and pose-correction guide](../../java/examples/hardware/vision.md) contains the canonical
bring-up order and source-specific recipes.

### 3. Path following and generation

The current Bordeaux follower is a low-level reference selector. Tune the team-owned controller or
the wrapped PathPlanner/Choreo controller for translation, rotation, feedforward, tolerance, and
replanning. Use `BordeauxSample.travelHeadingRad()` for translation direction; robot heading and path
travel direction are distinct on a holonomic drive.

Generator annotations are containment ceilings, not target tuning values. Mirror the robot's tested
velocity/acceleration constants into
[`BordeauxGenerationContext.safetyLimits()`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxGenerationContext.java)
and add explicit timeout, sample, duration, distance, centripetal, and clearance bounds. The runtime
takes the stricter descriptor/robot value in every dimension. `BordeauxDriveLimits` is not currently
converted to generator limits automatically.

The [tuning and simulation hardware guide](../../java/examples/hardware/tuning-and-simulation.md)
contains the full module, vision, generated-path, simulator, and robot validation checklists.

## Staged live tuning and holonomic runtime

There is currently no public Bordeaux gain-profile type, NetworkTables live-tuning manager, or
single command-returning Bordeaux follower. Do not write robot code against imagined methods such as
`Bordeaux.follow(...)`, and do not describe a `BordeauxDrive` adapter as proof that an automatic
controller ran.

Until those types land:

- use `BordeauxReferenceFollower` plus the team's tested controller for Bordeaux samples;
- wrap an existing PathPlanner or Choreo command when that library should retain controller and
  feedforward ownership;
- use `AquitaineRoutineLoop` to connect explicit routine progress to the robot-owned follower; and
- tune through the team's current constants, vendor tooling, or existing dashboard mechanism.

The staged design calls for immutable revisions applied between control loops, retention of the last
known-good revision after invalid input, and disabled-only geometry/hard-limit changes. Those are
design constraints, not behavior available from the current Java runtime.

## Repository checks

From `java/`, run focused Java verification:

```text
./gradlew :runtime:test :examples:test
```

Before release, run the full Java build:

```text
./gradlew test
./gradlew build
```

The [Java example gallery](../../java/examples/README.md) identifies which examples are
compile-checked, vendor-interface verified, or integration sketches. The
[template robot](../../examples/bordeaux-template-robot/README.md) is the GradleRIO integration
fixture; its README lists the catalog, test, build, and simulation commands expected after support is
installed.
