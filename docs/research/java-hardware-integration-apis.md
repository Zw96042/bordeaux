For each camera, call `camera.getAllUnreadResults()`, pass each result to `PhotonPoseEstimator.update(result)`, and map a present `EstimatedRobotPose` through `estimatedPose.toPose2d()` and `timestampSeconds`. PhotonVision's official pose-estimation example also computes a distance/tag-count-dependent `Matrix<N3,N1>` rather than treating every observation equally. ([camera queue](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photon-lib/src/main/java/org/photonvision/PhotonCamera.java#L244-L262), [pose update](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photon-lib/src/main/java/org/photonvision/PhotonPoseEstimator.java#L420-L449), [estimated pose fields](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photon-lib/src/main/java/org/photonvision/EstimatedRobotPose.java#L30-L55), [official Java example](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photonlib-java-examples/poseest/src/main/java/frc/robot/Vision.java#L86-L119))

The Bordeaux example should emit one observation per unread result, not only a “latest” result. It must own the standard-deviation policy; PhotonVision's result does not directly fill Bordeaux's three scalar uncertainty fields.

### Limelight

For MegaTag2, call the source's exact Java method `LimelightHelpers.SetRobotOrientation(...)`, then read `getBotPoseEstimate_wpiBlue_MegaTag2(name)`. `PoseEstimate` supplies `pose`, `timestampSeconds`, `tagCount`, `tagSpan`, `avgTagDist`, and `avgTagArea`, but no standard deviations. Reject null/no-tag results and derive configured uncertainty before making a Bordeaux observation. ([MegaTag2 getter](https://github.com/LimelightVision/limelightlib-wpijava/blob/7a3f813935f0db89e99dbaebd4b075a5946cc1cd/LimelightHelpers.java#L1518-L1536), [pose result](https://github.com/LimelightVision/limelightlib-wpijava/blob/7a3f813935f0db89e99dbaebd4b075a5946cc1cd/LimelightHelpers.java#L718-L761), [orientation setter](https://github.com/LimelightVision/limelightlib-wpijava/blob/7a3f813935f0db89e99dbaebd4b075a5946cc1cd/LimelightHelpers.java#L1700-L1727))

Use the blue-origin pose consistently; do not alliance-switch coordinate origins inside the vision adapter.

### QuestNav

Call `getAllUnreadPoseFrames()` every robot loop and use only frames whose `isTracking()` is true. Convert `frame.questPose3d().toPose2d()` and use `frame.dataTimestamp()`; QuestNav explicitly says the NetworkTables reception timestamp is the pose-estimator timestamp and the app timestamp is diagnostic-only. ([pose-frame contract](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/questnav-lib/src/main/java/gg/questnav/questnav/PoseFrame.java#L20-L78), [queue drain](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/questnav-lib/src/main/java/gg/questnav/questnav/QuestNav.java#L600-L646))

`setPose(Pose3d)` resets the **headset** pose; QuestNav's official troubleshooting guide says a known robot pose must first be transformed by the robot-to-Quest mounting transform. The Bordeaux vision adapter should not expose robot `resetPose` by directly forwarding it to QuestNav. ([set-pose warning](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/docs/versioned_docs/version-2026-2.2.0/1-getting-started/13-troubleshooting.md#L378-L391))

QuestNav does not provide Bordeaux's X/Y/heading standard deviations in `PoseFrame`; those remain an explicit team configuration/tuning policy.

## Existing path and routine systems

### PathPlanner

For command interoperability, configure PathPlanner's `AutoBuilder` with pose/reset suppliers, a robot-relative speed supplier, robot-relative output consumer (or the overload with `DriveFeedforwards`), a controller, `RobotConfig`, alliance-flip supplier, and drivetrain requirement. Then expose a fresh `AutoBuilder.followPath(PathPlannerPath.fromPathFile(name))` through a Bordeaux `Supplier<Command>` field. PathPlanner's follow command owns its event markers. ([AutoBuilder configuration](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/auto/AutoBuilder.java#L40-L151), [follow command](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/auto/AutoBuilder.java#L258-L279), [path loading](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/path/PathPlannerPath.java#L290-L327))

For runtime path generation, PathPlanner exposes `waypointsFromPoses(...)`, a `PathPlannerPath` constructor, and `generateTrajectory(startingRobotRelativeSpeeds, startingRotation, robotConfig)`. Its trajectory states contain field-relative pose/speeds, travel heading, linear velocity, and module feedforwards. A conversion to `BordeauxGeneratedTrajectory` would drop feedforwards today, so the safe first template is a command wrapper, not a claim of lossless Bordeaux-sample conversion. ([waypoint conversion](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/path/PathPlannerPath.java#L190-L240), [trajectory generation](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/path/PathPlannerPath.java#L1140-L1164), [state fields](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/trajectory/PathPlannerTrajectoryState.java#L14-L40))

### Choreo

Choreo loads deploy trajectories with `Choreo.loadTrajectory(name)`, samples with `trajectory.sampleAt(time, flip)`, and exposes `getInitialPose(flip)`. `AutoFactory` accepts pose/reset callbacks, a sample controller, alliance flipping, and a drivetrain subsystem; `SwerveSample` carries field pose, field-relative X/Y velocity, angular motion, acceleration, and per-module force arrays. ([loading](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/choreolib/src/main/java/choreo/Choreo.java#L70-L110), [sampling](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/choreolib/src/main/java/choreo/trajectory/Trajectory.java#L145-L177), [AutoFactory](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/choreolib/src/main/java/choreo/auto/AutoFactory.java#L100-L202), [swerve sample](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/choreolib/src/main/java/choreo/trajectory/SwerveSample.java#L15-L121))

Do not pass `SwerveSample.getChassisSpeeds()` directly to Bordeaux's robot-relative output: the sample's `vx`/`vy` are documented in field axes. The Choreo controller must calculate/convert the robot-relative command. As with PathPlanner, a command supplier preserves Choreo's own controller and force-feedforward behavior; conversion to current `BordeauxSample` is not lossless.

### Aquitaine and custom generators

Aquitaine is Bordeaux's routine format, not an external dependency. The current runtime can sequence static paths, commands, waits, decisions, and generated-trajectory steps. A generated step invokes a bounded `@BordeauxTrajectoryGenerator` method returning `BordeauxGeneratedTrajectory`; only after complete runtime validation does `BordeauxRoutineProgress.GeneratedTrajectory` expose its immutable samples to the caller. ([routine states](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxRoutineProgress.java), [runner transitions](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxRoutineRunner.java), [generator annotation](../../java/annotations/src/main/java/dev/bordeaux/annotations/BordeauxTrajectoryGenerator.java), [generated result](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxGeneratedTrajectory.java))

An existing PathPlanner/Choreo “generate and follow” command can already be exposed as an ordinary Bordeaux command supplier. It is **not** equivalent to an Aquitaine generated-trajectory node: the latter must return samples so Bordeaux can enforce its declared timeout, sample, field-containment, collision, velocity, acceleration, curvature, and angular limits before motion. ([generated containment](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxGeneratedTrajectoryExecutor.java), [command supplier contract](../../java/annotations/src/main/java/dev/bordeaux/annotations/BordeauxCommand.java))

## Template recommendations

Build examples in this order:

1. A vendor-neutral `SubsystemBase` template that caches exactly one `BordeauxDriveState` per loop and shows a WPILib `SwerveDrivePoseEstimator` plus vision delivery.
2. A CTRE Phoenix 6 adapter using native atomic state and explicit CTRE/FPGA timebase conversion.
3. A REV MAXSwerve adaptation that visibly adds the missing SI `ChassisSpeeds`, measured-speed, cached-state, and pose-estimator pieces.
4. A YAGSL adapter marked source-verified but **not 2026 artifact-verified** until its official vendordep changes.
5. Separate PhotonVision, Limelight, and QuestNav producers of `BordeauxVisionObservation`, each with rejection and uncertainty hooks.
6. IMU snippets for Pigeon 2, ADIS16470, ADXRS450, Redux Canandgyro, and Studica NavX3 inside the custom-estimator template; keep legacy KauaiLabs AHRS separate.
7. PathPlanner and Choreo command-supplier examples first; only add trajectory converters after Bordeaux has a deliberate feedforward/force preservation contract.

Every hardware example needs a simulated/fake implementation of the Bordeaux seam so its safety, timebase, stop, reset, and vision behavior can be tested without vendor JNI.

## Highest-risk gaps

- **YAGSL release gap:** the source API is usable, but the official rolling vendordep still targets 2025. A 2026 compile guarantee cannot be made from first-party artifacts today.
- **Snapshot honesty:** YAGSL and stock MAXSwerve lack one atomic pose/speeds/timestamp getter. Sequential method references directly in the builder would violate `BordeauxDrive.state()`'s contract.
- **CTRE timebases:** Phoenix drivetrain state/vision uses CTRE current time, while Bordeaux uses FPGA seconds. Both directions require the explicit `Utils` conversions.
- **Vision covariance:** Limelight and QuestNav do not provide Bordeaux's three standard deviations in the verified result objects. PhotonVision's official example calculates them outside `EstimatedRobotPose`. Templates need configurable, tested uncertainty policies.
- **Path data loss:** PathPlanner module feedforwards and Choreo module force arrays cannot pass through the current `BordeauxSample`. Command wrapping is functional; sample conversion is not yet feature-complete.
- **Quest reset semantics:** QuestNav resets headset pose, not robot pose. Forwarding Bordeaux `resetPose` directly would be wrong without the mounting transform.
- **Legacy navX:** the old KauaiLabs `AHRS` API and current Studica `Navx` API are distinct. No current 2026 KauaiLabs artifact or verified FPGA conversion for `getLastSensorTimestamp()` was found.
- **Stop semantics:** each template must show and test its actual zero/idle output. A missing callback or a pose reset is not a stop.
