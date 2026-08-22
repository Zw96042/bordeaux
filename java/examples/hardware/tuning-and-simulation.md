# Tuning, simulation, and bring-up

There are three separate tuning layers. Keeping them separate makes failures diagnosable:

1. **Hardware control:** wheel radius, ratios, offsets, inversion, current limits, steer PID, drive
   velocity PID/feedforward, and characterization. This stays in CTRE, YAGSL, REV, or team code.
2. **Localization:** odometry noise, per-camera X/Y/heading standard deviations, rejection gates, and
   timestamp alignment. This stays with the estimator that owns `BordeauxDriveState`.
3. **Path following:** translation/rotation feedback, motion feedforward, tolerances, and replanning.
   This belongs to the Bordeaux command-returning follower as that runtime slice lands.

Do not tune path feedback around a drivetrain that cannot accurately hold a requested constant robot-
relative speed.

## Hard robot limits — compile-checked

```java
var limits = new BordeauxDriveLimits(
    4.8,   // maximum linear velocity, m/s
    7.0,   // maximum linear acceleration, m/s^2
    9.0,   // maximum angular velocity, rad/s
    18.0); // maximum angular acceleration, rad/s^2
```

Every current `BordeauxDriveAdapter` output is checked for finite values and linear/angular velocity
before reaching the subsystem. Generated-trajectory containment uses acceleration limits between
successive samples. The staged command-returning follower will use the same limits at its output seam.
Map those same drivetrain constants into each `BordeauxGenerationContext.safetyLimits()`; the current
runtime does not convert `BordeauxDriveLimits` into generator limits automatically.
Start with tested values below theoretical free speed, then raise them from logs. A velocity limit is
not a substitute for motor current limiting or module-level slew/torque control.

## Module and drivetrain tuning

Before following a path, verify each item independently:

- absolute angle offsets survive reboot and every module reports forward at the same physical angle;
- positive chassis X drives forward, positive Y drives left, and positive omega turns counterclockwise;
- measured module velocity uses meters per second, not motor RPM;
- measured chassis speed comes from actual module states, not the latest requested state;
- robot-relative closed-loop output tracks positive and negative X/Y/omega together;
- wheel-speed desaturation preserves the requested direction;
- safe stop sends a real zero/idle request and is tested while the robot is enabled on blocks;
- the estimator reset changes field pose without unexpectedly zeroing physical sensors.

Use the vendor's SysId/characterization and closed-loop tooling for this layer. Bordeaux intentionally
does not rewrite Talon or SPARK configuration.

## Vision covariance and correction

Tune each source separately. Record estimator pose and raw vision pose while driving known lines,
turning in place, viewing one tag at increasing distance, viewing multiple tags, and briefly losing
tracking. Use the residual distribution to choose positive standard deviations.

Typical policy inputs include tag count, distance, ambiguity, tag span, motion blur/angular speed, and
camera health. The numbers are standard deviations, not arbitrary trust percentages. A very large
heading standard deviation is appropriate when a source should correct translation but not heading;
zero is never appropriate.

Validate latency by replaying a fast turn. If delayed observations pull the estimate along the robot's
current heading instead of its capture-time heading, the timestamp epoch or latency is wrong.

## Generated-path tuning

Generator annotations are hard containment, not desired operating points. Set bounds no larger than
the robot and field can safely accept. The robot's `BordeauxGenerationContext.safetyLimits()` may be
stricter; Bordeaux takes the stricter value in every dimension.

Test at least:

- exactly two samples and maximum sample count;
- current robot pose and a nonzero current velocity;
- field edges and obstacle clearance;
- timeout, thrown exception, NaN, duplicate time, and backward distance;
- excessive linear, centripetal, angular velocity, and acceleration;
- validated static fallback and safe-stop-only failure;
- interruption while generation is pending.

The introductory gallery generator intentionally requires the robot to be stopped. A moving-start
generator must make its first segment continuous with the injected field velocity and angular velocity.

## Deterministic simulation template — compile-checked

Test the Bordeaux seam without vendor JNI first. The gallery's
[`DeterministicSwervePlant`](../src/main/java/dev/bordeaux/examples/simulation/DeterministicSwervePlant.java)
is a fixed-step first-order plant that integrates combined robot-relative X/Y/omega requests. Its test
runs the same trace twice and checks safe stop. A smaller inline fake looks like:

```java
final class FakeDrive implements Subsystem, MethodReferenceDriveAdapter.ExistingSwerve {
    private final AtomicReference<BordeauxDriveState> state = new AtomicReference<>(
        new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 0));
    private ChassisSpeeds lastOutput = new ChassisSpeeds();
    private boolean stopped;

    @Override public Subsystem requirement() { return this; }
    @Override public BordeauxDriveState bordeauxState() { return state.get(); }
    @Override public void driveRobotRelative(ChassisSpeeds speeds) { lastOutput = speeds; }
    @Override public void resetPose(Pose2d pose) { /* update simulated estimator */ }
    @Override public void addVisionMeasurement(BordeauxVisionObservation value) { /* queue */ }
    @Override public void stop() { stopped = true; lastOutput = new ChassisSpeeds(); }
}
```

The gallery's [`DriveExamplesTest`](../src/test/java/dev/bordeaux/examples/drive/DriveExamplesTest.java)
does this for state, output, reset, vision, limits, and stop. Extend the deterministic plant with the
controller under test, run at a fixed 20 ms step, and assert pose/error tolerances in addition to exact
repeatability.

After the vendor-free contract passes, run the vendor's simulator: Phoenix 6 `updateSimState`, YAGSL's
MapleSim integration, or the custom WPILib drivetrain simulation. Finally test on blocks at low limits,
then in an open field with an immediate disable path.

## Current versus staged tuning surface

The repository currently ships and tests:

- the vendor-neutral drive/vision boundary and hard limits;
- complete trajectory dynamics and translation-direction samples;
- mixed time/position reference selection;
- events, commands, waits, decisions, routines, and generated-path containment;
- robot-owned WPILib/vendor pose-estimator integration.

The single command-returning holonomic runtime, live atomic gain profiles, Bordeaux-owned delayed
vision estimator, and production vendor adapter artifacts are staged in the Java runtime plan and are
not presented as already-shipped APIs in these examples. Until those public types land, tune the
team's existing follower (or the wrapped PathPlanner/Choreo command) and use Bordeaux's low-level
reference/routine APIs. This avoids examples that compile only because they invented a future API.

When live tuning lands, apply immutable revisions between control loops, retain the last known-good
profile after invalid input, and allow geometry/hard-limit changes only while disabled. Gain changes
must never partially apply across translation and rotation controllers.

## Robot validation checklist

- Compile the exact robot project with its pinned vendordeps.
- Confirm no vendor class enters `bordeaux-runtime`'s dependency graph.
- Log the `BordeauxDriveState` timestamp and assert it is monotonic FPGA time.
- Command combined X/Y/omega and verify all three survive the adapter.
- Reject an intentionally over-limit request before any motor output callback.
- Reset pose without changing the physical IMU zero.
- Deliver delayed and outlier vision from every source.
- Disconnect one camera and one non-authoritative sensor.
- Interrupt every motion state and verify one safe zero output.
- Run every Aquitaine decision branch, wait, generated fallback, and command requirement conflict.
- Re-run after reboot to catch lost offsets, configuration, and clock assumptions.
