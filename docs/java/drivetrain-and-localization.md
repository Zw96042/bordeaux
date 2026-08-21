# Drivetrain and localization

> **Current status:** Bordeaux ships the vendor-neutral `BordeauxDrive` seam, its method-reference
> adapter, normalized vision observations, enforced output velocity limits, and compile-checked
> examples. The
> command-returning Bordeaux holonomic follower and Bordeaux-owned localization runtime are staged;
> no current production `Command` consumes `BordeauxDrive` automatically.

The robot remains the owner of its modules, motor controllers, IMU, odometry thread, and corrected
pose estimator. Bordeaux sees the drivetrain at chassis level, so changing an SDS, REV, WCP,
Thrifty, or custom module does not require a new core runtime type.

## The shipped drive seam

[`BordeauxDrive`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDrive.java) covers
these responsibilities:

- return the drivetrain's WPILib `Subsystem` requirement;
- return one corrected pose, measured robot-relative speed, and source timestamp snapshot;
- expose tested linear and angular velocity/acceleration limits;
- accept finite robot-relative `ChassisSpeeds` output;
- reset estimator pose without implicitly zeroing physical IMU hardware;
- report whether normalized vision delivery is supported;
- optionally deliver a normalized vision measurement to that same estimator; and
- issue the drivetrain's immediate safe-stop operation.

Connect an existing subsystem with
[`BordeauxDriveAdapter`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveAdapter.java):

```java
BordeauxDrive bordeauxDrive = BordeauxDriveAdapter.forSubsystem(drivetrain)
    .state(stateCache::state)
    .output(drivetrain::driveRobotRelative)
    .resetPose(drivetrain::resetPose)
    .visionMeasurement(drivetrain::addVisionMeasurement)
    .stop(drivetrain::stop)
    .limits(new BordeauxDriveLimits(4.8, 7.0, 9.0, 18.0))
    .build();
```

The vision callback is optional. If it is omitted, `acceptsVisionMeasurements()` is false and
`addVisionMeasurement(...)` fails explicitly instead of silently dropping a correction. The builder
requires state, output, reset, stop, and limits callbacks.

`driveRobotRelative(...)` currently checks that all three values are finite and that translation and
rotation stay within the configured velocity limits. It copies the mutable WPILib value before
delivery. It does **not** infer acceleration between calls, desaturate module states, or configure
vendor motor control. Acceleration limits are exposed to callers and staged controller work.
Generated-path containment does not read `BordeauxDriveLimits`; map the same tested constants into
the generation context's `BordeauxTrajectoryGeneratorLimits` explicitly.

For the copyable adapter and vendor-specific mappings, use the
[`MethodReferenceDriveAdapter`](../../java/examples/src/main/java/dev/bordeaux/examples/drive/MethodReferenceDriveAdapter.java)
and [drivetrain hardware guide](../../java/examples/hardware/drivetrains.md).

## Publish state atomically

[`BordeauxDriveState`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveState.java)
is one immutable control-iteration snapshot:

```java
double timestampS = Timer.getFPGATimestamp();
Pose2d pose = poseEstimator.updateWithTime(timestampS, heading, modulePositions);
ChassisSpeeds measured = kinematics.toChassisSpeeds(moduleStates);
stateCache.update(pose, measured, timestampS);
```

The pose, measured robot-relative X/Y/omega, and timestamp must describe the same estimator update.
Do not read pose in one loop, speed in another, and stamp both with the current time. Do not substitute
the last requested speed for measured module-derived speed.

When the estimator runs on another thread, publish the whole snapshot through one atomic reference.
The compile-checked
[`AtomicDriveStateCache`](../../java/examples/src/main/java/dev/bordeaux/examples/drive/AtomicDriveStateCache.java)
shows that pattern. `BordeauxDriveAdapter` does not add synchronization around a callback that returns
split mutable state.

The timestamp is nonnegative FPGA seconds. If a vendor reports another epoch, convert it using that
vendor's documented clock conversion before constructing the state. If the selected IMU and modules
have no per-sample timestamps, read them and `Timer.getFPGATimestamp()` together in the estimator
loop.

## One estimator owns IMU and pose correction

The IMU normally feeds the estimator that produces `BordeauxDriveState`; Bordeaux does not ask for a
second raw heading. This prevents two filters from disagreeing about gyro offset, field heading, or
vision history.

- CTRE or YAGSL teams normally expose their drivetrain's already-corrected estimator state.
- REV-template and custom WPILib teams normally expose their `SwerveDrivePoseEstimator` state.
- `resetPose(...)` changes the estimator's field pose. Hardware yaw reset remains a separate,
  deliberate team operation.
- Heading follows WPILib field conventions: positive rotation is counterclockwise, and path/vision
  poses use the blue-origin field frame on both alliances.

The [IMU guide](../../java/examples/hardware/imus.md) records the verified integration status for
Pigeon 2, ADIS16470, ADXRS450, Canandgyro, NavX3, legacy navX, and generic heading sources. The
compile-checked [`WpilibImuHeadings`](../../java/examples/src/main/java/dev/bordeaux/examples/imu/WpilibImuHeadings.java)
keeps sensor axis and sign conversion visible.

## Normalize vision before fusion

Every accepted camera result crosses the seam as
[`BordeauxVisionObservation`](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxVisionObservation.java):

```java
new BordeauxVisionObservation(
    "photon-front",
    fieldPose,
    captureTimestampS,
    xStdDevM,
    yStdDevM,
    headingStdDevRad);
```

The record requires a visible source ID, finite blue-origin pose, nonnegative FPGA capture time, and
positive X/Y/heading standard deviations. These constructor checks are necessary but not sufficient
camera validation. Before fusion, team code should also reject unknown tags, impossible field poses,
duplicate or non-increasing frames, poor ambiguity/geometry, unhealthy sources, and measurements that
violate its estimator's innovation policy.

[`VisionObservationFactory`](../../java/examples/src/main/java/dev/bordeaux/examples/vision/VisionObservationFactory.java)
provides compile-checked capture-time and latency conversions. Its `tryFromCaptureTimestamp(...)`
returns `Optional.empty()` for malformed or out-of-field input so an untrusted frame does not throw
from the robot loop. Deliver accepted observations once, sorted by capture time when combining
sources.

For a WPILib estimator, the compile-checked
[`WpilibPoseEstimatorVision`](../../java/examples/src/main/java/dev/bordeaux/examples/vision/WpilibPoseEstimatorVision.java)
passes the pose, capture timestamp, and three standard deviations to
`SwerveDrivePoseEstimator.addVisionMeasurement(...)`. Fuse into the estimator that supplies
`BordeauxDriveState`; do not fuse in a vendor drivetrain and then repeat the correction in another
filter.

The [vision guide](../../java/examples/hardware/vision.md) contains the maintained PhotonVision,
Limelight, QuestNav, multi-camera, and custom-coprocessor recipes, with an explicit verification level
for each.

## Bring-up sequence

1. Validate module offsets, units, inversion, and combined positive X/Y/omega without vision.
2. Validate IMU sign and estimator reset without physically zeroing the sensor.
3. Publish and log atomic state; assert its FPGA timestamp is monotonic.
4. Log each vision source without fusing it; verify frame, capture time, field bounds, and uniqueness.
5. Tune and fuse one source conservatively, then add sources individually.
6. Exercise delayed frames, duplicates, outliers, disconnects, over-limit output, and safe stop.

The [Java example gallery](../../java/examples/README.md) is the canonical index. The
[complete template robot](../../examples/bordeaux-template-robot/README.md) demonstrates catalog and
event integration but intentionally does not pretend to contain a drivetrain or follower.
