# Bordeaux Java example gallery

Start with the example that matches code the robot already owns. The classes under
[`src/main/java`](src/main/java) are compiled with the Java library and tested under
[`src/test/java`](src/test/java); the hardware guides use the same seam but keep optional vendor
libraries out of `bordeaux-runtime`.

The [Java documentation home](../../docs/java/index.md) explains how these pieces fit into a robot;
this page is the source and verification index.

## Choose an integration

| Existing robot code | Start here | Verification |
| --- | --- | --- |
| A teleop or autonomous `Command` | [`ExistingCommandProvider`](src/main/java/dev/bordeaux/examples/commands/ExistingCommandProvider.java) | Compile-checked and tested |
| Any swerve subsystem with a corrected pose | [`MethodReferenceDriveAdapter`](src/main/java/dev/bordeaux/examples/drive/MethodReferenceDriveAdapter.java) | Compile-checked and tested |
| An estimator updated on another thread | [`AtomicDriveStateCache`](src/main/java/dev/bordeaux/examples/drive/AtomicDriveStateCache.java) | Compile-checked and tested |
| WPILib `SwerveDrivePoseEstimator` vision fusion | [`WpilibPoseEstimatorVision`](src/main/java/dev/bordeaux/examples/vision/WpilibPoseEstimatorVision.java) | Compile-checked |
| A camera pose and capture time | [`VisionObservationFactory`](src/main/java/dev/bordeaux/examples/vision/VisionObservationFactory.java) | Compile-checked and tested |
| ADIS16470 or ADXRS450 | [`WpilibImuHeadings`](src/main/java/dev/bordeaux/examples/imu/WpilibImuHeadings.java) | Compile-checked against WPILib 2026.2.2 |
| A custom Aquitaine generated-path step | [`SafeGeneratedTrajectoryProvider`](src/main/java/dev/bordeaux/examples/generation/SafeGeneratedTrajectoryProvider.java) | Processor-checked and tested |
| Runtime containment for generated steps | [`ContainedGeneratedRoutine`](src/main/java/dev/bordeaux/examples/generation/ContainedGeneratedRoutine.java) | Compile-checked |
| Aquitaine progress-to-follower lifecycle | [`AquitaineRoutineLoop`](src/main/java/dev/bordeaux/examples/generation/AquitaineRoutineLoop.java) | Compile-checked and containment-tested |
| A repeatable controller/adapter plant | [`DeterministicSwervePlant`](src/main/java/dev/bordeaux/examples/simulation/DeterministicSwervePlant.java) | Compile-checked and tested |
| A complete robot project | [`../../examples/bordeaux-template-robot`](../../examples/bordeaux-template-robot) | GradleRIO integration fixture |

The two top-level files, [`RobotCommands.java`](RobotCommands.java) and
[`RobotContainerSnippet.java`](RobotContainerSnippet.java), remain short copy/paste snippets for a
team project. The packaged examples are the authoritative compile-checked versions.

## Hardware recipes

- [Drivetrains and swerve modules](hardware/drivetrains.md): CTRE Phoenix 6, YAGSL, REV MAXSwerve,
  and custom WPILib swerve.
- [IMUs](hardware/imus.md): Pigeon 2, navX/navX2, ADIS16470, ADXRS450, Redux Canandgyro, and a
  generic heading source.
- [Vision and pose correction](hardware/vision.md): PhotonVision, Limelight, QuestNav,
  multi-camera delivery, capture timestamps, and WPILib Kalman fusion.
- [Path tools and Aquitaine](hardware/path-tools-and-aquitaine.md): existing WPILib commands,
  PathPlanner, Choreo, decisions, waits, events, and bounded runtime-generated trajectories.
- [Tuning, simulation, and bring-up](hardware/tuning-and-simulation.md): hard limits, estimator
  noise, deterministic tests, and the boundary between currently shipped and staged runtime work.

Every recipe heading states its verification level. **Compile-checked** and **processor-checked**
examples run in this repository. Labels such as **vendor API verified**, **source verified**,
**helper API verified**, and **official-template recipe** mean the call surface is traced to the
linked official version or source but is not compiled in Bordeaux's vendor-free default build.
**Integration sketch** means an official, versioned Java surface was not available to verify; those
blocks are deliberately pseudocode rather than made-up vendor classes.

The linked vendor versions and primary sources were last audited on 2026-08-19; see the dated
[hardware API research snapshot](../../docs/research/java-hardware-integration-apis.md). Treat the
snapshot as verification history, not a promise that a vendor's latest release remains unchanged.

## Why there is one drivetrain seam

Bordeaux accepts corrected pose, measured robot-relative speed, robot-relative output, pose reset,
optional timestamped vision, and safe stop. Module construction remains in the robot project. That
keeps SDS, REV, WCP, Thrifty, homemade, brushed, brushless, Talon, and SPARK module choices compatible
without coupling path following to a motor-controller release. CTRE and YAGSL teams usually delegate
to their existing estimator; custom and REV-template teams usually delegate to their existing WPILib
`SwerveDrivePoseEstimator`.

Publish pose, speed, and source timestamp together. Do not build a Bordeaux state by reading pose in
one loop, speed in another, and stamping both with the current time. The cache example exists to make
that invariant easy.

## Run the gallery

From `java/`:

```text
./gradlew :examples:test
```

The gallery intentionally has no CTRE, REV, YAGSL, navX, Redux, PhotonVision, Limelight,
PathPlanner, Choreo, or QuestNav dependency. A vendor update therefore cannot break teams that do not
use that vendor, and a documentation snippet is never presented as stronger verification than it
actually received.
