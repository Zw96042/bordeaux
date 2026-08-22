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
