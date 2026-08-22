# Java hardware integration APIs

Research date: 2026-08-19

## Conclusion

Bordeaux should keep one small WPILib-level hardware seam and put vendor code in examples or optional adapters. The existing `BordeauxDriveAdapter` already asks for the right high-level operations: one atomic corrected `Pose2d` plus robot-relative `ChassisSpeeds` at an FPGA timestamp, robot-relative output, estimator reset, optional normalized vision delivery, and an explicit stop callback. ([Bordeaux drive contract](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDrive.java), [method-reference adapter](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveAdapter.java), [atomic state](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveState.java))

Do not make motor, module, gyro, or camera brands part of Bordeaux core. CTRE, YAGSL, MAXSwerve, and custom WPILib drivetrains can all satisfy the same seam, but they do **not** offer the same snapshot guarantees. CTRE supplies a thread-safe state copy with pose, robot-centric speeds, and a source timestamp. YAGSL exposes pose and velocity through separate calls. REV's stock 2026 MAXSwerve template exposes pose and reset but no robot-relative speed getter or `ChassisSpeeds` output method. The latter two therefore need a tiny team-side wrapper that caches pose, measured speeds, and `Timer.getFPGATimestamp()` together once per robot loop. ([CTRE drivetrain state](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/using-swerve-api.html#odometry-and-state), [YAGSL getters](https://github.com/BroncBotz3481/YAGSL/blob/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc/swervelib/SwerveDrive.java#L839-L914), [REV 2026 template](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/DriveSubsystem.java#L54-L133), [WPILib FPGA clock](https://github.wpilib.org/allwpilib/docs/release/java/edu/wpi/first/wpilibj/Timer.html#getFPGATimestamp()))

IMUs should normally feed the team-owned pose estimator, not Bordeaux directly. Vision systems should be normalized to `BordeauxVisionObservation` only after rejecting invalid frames and assigning explicit X/Y/heading standard deviations. PathPlanner and Choreo commands can be registered as ordinary Bordeaux command suppliers; lossless trajectory conversion is a separate feature because both libraries carry data that `BordeauxSample` does not currently retain (notably module feedforwards/forces). ([normalized vision record](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxVisionObservation.java), [Bordeaux command fields](../../java/annotations/src/main/java/dev/bordeaux/annotations/BordeauxCommand.java), [PathPlanner trajectory state](https://github.com/mjansen4857/pathplanner/blob/e02bbf3176588166e8fe5192ab8dea85f6d62f7a/pathplannerlib/src/main/java/com/pathplanner/lib/trajectory/PathPlannerTrajectoryState.java#L14-L40), [Choreo swerve sample](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/choreolib/src/main/java/choreo/trajectory/SwerveSample.java#L15-L78))

## Version snapshot

These are verified season artifacts, not promises that a version will remain latest:

| Integration | Verified 2026 artifact | Installation fact |
| --- | --- | --- |
| WPILib | Bordeaux currently compiles against 2026.2.2 | GradleRIO supplies WPIMath and Commands to the robot project. ([runtime build](../../java/runtime/build.gradle.kts)) |
| CTRE Phoenix 6 | 26.3.0 stable was present; 26.50.0-alpha-1 was also published but is not a stable template target | The official Maven metadata is authoritative; templates should not select the alpha merely because it is metadata's `latest`. ([official metadata](https://maven.ctr-electronics.com/release/com/ctre/phoenix6/wpiapi-java/maven-metadata.xml), [26.3.0 source artifact](https://maven.ctr-electronics.com/release/com/ctre/phoenix6/wpiapi-java/26.3.0/wpiapi-java-26.3.0-sources.jar)) |
| REVLib | 2026.0.5 | Use REV's season vendordep URL. ([official vendordep](https://software-metadata.revrobotics.com/REVLib-2026.json)) |
| YAGSL | **No 2026 release verified** | The official rolling vendordep still identifies 2025.8.0/FRC 2025, even though the source tree contains newer APIs. Do not publish a “2026-ready” compile-tested template until YAGSL publishes a 2026 artifact. ([official vendordep](https://broncbotz3481.github.io/YAGSL-Lib/yagsl/yagsl.json), [official source](https://github.com/BroncBotz3481/YAGSL/tree/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc)) |
| ReduxLib | 2026.1.2 | Use the season vendordep. ([official vendordep](https://frcsdk.reduxrobotics.com/ReduxLib_2026.json), [matching source tag](https://github.com/Redux-Robotics/canandrepo-public/tree/reduxlib-v2026.1.2/ReduxLib)) |
| StudicaLib/NavX3 | 2026.0.2 | Use Studica's 2026 vendordep. ([official vendordep](https://dev.studica.com/maven/release/2026/json/StudicaLib-2026.0.2.json), [official 2026 example](https://github.com/Studica-Robotics/NavX/tree/b70592e03bbf285f22302cebc837962bc0f2fa16/Example%20Projects/NavX3-java)) |
| PhotonVision | v2026.3.2 API/docs reviewed | PhotonVision directs teams to install PhotonLib through WPILib's vendor-library UI or its release bundle. ([official installation](https://docs.photonvision.org/en/v2026.3.2/docs/programming/photonlib/adding-vendordep.html), [v2026.3.2 source](https://github.com/PhotonVision/photonvision/tree/v2026.3.2/photon-lib)) |
| PathPlannerLib | 2026.1.2 | Use the official rolling vendordep. ([official vendordep](https://3015rangerrobotics.github.io/pathplannerlib/PathplannerLib.json)) |
| ChoreoLib | 2026.0.3 | Use the official season vendordep. ([official vendordep](https://choreo.autos/lib/ChoreoLib2026.json)) |
| QuestNav | 2026 documentation 2.2.0 reviewed | A stable 2026 vendordep URL/version was not verified from the repository's generated metadata; keep the example version-labeled and link its installation docs. ([official 2026 docs source](https://github.com/QuestNav/QuestNav/tree/8c2e963a7f08fac6ea095b06cb0f35dae3770119/docs/versioned_docs/version-2026-2.2.0), [vendordep generation](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/questnav-lib/build.gradle#L90-L110)) |
| Limelight | Helpers source commit `7a3f813` reviewed | Limelight publishes the single-file Java helper and releases directly; no season vendordep is required by that helper. ([official library README](https://github.com/LimelightVision/limelightlib-wpijava/blob/7a3f813935f0db89e99dbaebd4b075a5946cc1cd/README.md), [official releases](https://github.com/LimelightVision/limelightlib-wpijava/releases)) |

## Drivetrain wrappers

### CTRE Phoenix 6 swerve

This is the closest direct fit.

- State: call `getStateCopy()` once. Use `state.Pose`, `state.Speeds`, and convert `state.Timestamp` from CTRE current-time to FPGA time with `Utils.currentTimeToFPGATime(...)`. CTRE documents `Speeds` as robot-centric and `Timestamp` as the `Utils.getCurrentTimeSeconds()` timebase. ([official API guide](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/using-swerve-api.html#odometry-and-state), [26.3.0 source artifact](https://maven.ctr-electronics.com/release/com/ctre/phoenix6/wpiapi-java/26.3.0/wpiapi-java-26.3.0-sources.jar))
- Output: reuse one `SwerveRequest.ApplyRobotSpeeds`, call `withSpeeds(speeds)`, then `drivetrain.setControl(request)`. CTRE explicitly recommends converting custom control to `ChassisSpeeds` and reusing built-in requests. ([swerve requests](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/swerve-requests.html))
- Reset: `drivetrain.resetPose(pose)` uses the blue-alliance field perspective. Stop: `drivetrain.setControl(new SwerveRequest.Idle())`. ([pose reset](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/using-swerve-api.html#setting-the-robot-heading), [idle request](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/swerve-requests.html))
- Vision: call the overload of `addVisionMeasurement(pose, timestamp, stdDevs)`, but first convert Bordeaux's FPGA timestamp with `Utils.fpgaToCurrentTime(...)`; CTRE's estimator expects the CTRE current-time epoch. ([26.3.0 source artifact](https://maven.ctr-electronics.com/release/com/ctre/phoenix6/wpiapi-java/26.3.0/wpiapi-java-26.3.0-sources.jar))
- Requirement: use the generated `CommandSwerveDrivetrain` (or the team's subsystem wrapper), which CTRE's project generator makes a WPILib `Subsystem`. ([builder API](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/mechanisms/swerve/swerve-builder-api.html#generated-code))

Do not use `state.Timestamp` as an FPGA timestamp without conversion; the numeric epochs are not the same.

### YAGSL

The verified source exposes `getPose()`, `getRobotVelocity()`, `drive(ChassisSpeeds)`, `setChassisSpeeds(ChassisSpeeds)`, `resetOdometry(Pose2d)`, and `addVisionMeasurement(Pose2d, double, Matrix<N3,N1>)`. `drive(ChassisSpeeds)` is documented as robot-oriented; the vision timestamp is documented as FPGA time or a similar startup-relative timebase. ([drive methods](https://github.com/BroncBotz3481/YAGSL/blob/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc/swervelib/SwerveDrive.java#L510-L608), [pose and velocity](https://github.com/BroncBotz3481/YAGSL/blob/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc/swervelib/SwerveDrive.java#L831-L923), [vision](https://github.com/BroncBotz3481/YAGSL/blob/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc/swervelib/SwerveDrive.java#L1288-L1342))

`SwerveDrive` is not itself the WPILib subsystem requirement, and its pose and velocity getters are separate. A Bordeaux example should therefore live in the team's `SubsystemBase`, cache a `BordeauxDriveState` once in `periodic()`, delegate output to `swerveDrive.drive(speeds)` or `setChassisSpeeds(speeds)`, delegate reset/vision, and stop with zero `ChassisSpeeds`. Do not label the current example compile-verified for 2026 while the official vendordep remains FRC 2025. ([class declaration](https://github.com/BroncBotz3481/YAGSL/blob/65874df0b22f5dcbfb2b228d08db7f02b57ec6fc/swervelib/SwerveDrive.java#L74), [official vendordep](https://broncbotz3481.github.io/YAGSL-Lib/yagsl/yagsl.json))

### REV MAXSwerve / SPARK

REV's official 2026 template uses four `MAXSwerveModule` objects, `SwerveDriveOdometry`, and an `ADIS16470_IMU`. It updates odometry in `periodic()`, exposes `getPose()` and `resetOdometry(Pose2d)`, and accepts normalized scalar inputs through `drive(xSpeed, ySpeed, rot, fieldRelative)`. It does not expose measured robot-relative chassis speeds, direct SI-unit `ChassisSpeeds` output, or pose-estimator vision fusion. ([DriveSubsystem setup and periodic](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/DriveSubsystem.java#L22-L78), [public drive API](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/DriveSubsystem.java#L80-L160))

The Bordeaux template must add, visibly and in team code:

1. A measured speed method using `DriveConstants.kDriveKinematics.toChassisSpeeds(moduleStates)`.
2. A robot-relative output method using `toSwerveModuleStates(speeds)`, wheel-speed desaturation, and the existing module `setDesiredState` calls.
3. A cached state produced in `periodic()` after odometry update.
4. `stop()` by sending zero chassis speeds.
5. If vision is desired, replacement of `SwerveDriveOdometry` with the appropriate WPILib pose estimator before exposing `visionMeasurement`; Bordeaux must not claim that the stock template fuses vision.

Those additions use the same kinematics and module calls already present in REV's template. ([module state output](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/DriveSubsystem.java#L117-L153), [MAXSwerve module state getter](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/MAXSwerveModule.java#L107-L124))

## IMU sources

An IMU example should show how the **team estimator** gets heading, not invent a second Bordeaux estimator beside CTRE/YAGSL. Publish a standalone estimator template only for custom WPILib drivetrains.

| IMU | Verified Java calls | Timestamp/reset implications |
| --- | --- | --- |
| CTRE Pigeon 2 | `getRotation2d()` is the convenient WPILib heading; `getYaw()` and `getAngularVelocityZWorld()` return status signals; `setYaw(...)` and `reset()` are available. ([Pigeon2 26.3.0 source](https://maven.ctr-electronics.com/release/com/ctre/phoenix6/wpiapi-java/26.3.0/wpiapi-java-26.3.0-sources.jar), [Pigeon signals](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/status-signals.html#pigeon-2-signals)) | Prefer the CTRE drivetrain's own estimator/state when using CTRE swerve. For a custom estimator, refresh and inspect the `StatusSignal` timestamp rather than assigning a later loop time. Do not zero hardware from Bordeaux `resetPose`; reset the estimator offset. |
| WPILib ADIS16470 | `getAngle(axis)`, `getRate(axis)`, and `reset()` are present; the MAXSwerve template uses the Z axis. ([ADIS16470 Javadoc](https://github.wpilib.org/allwpilib/docs/release/java/edu/wpi/first/wpilibj/ADIS16470_IMU.html), [REV usage](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/b6145898c3103c22dc060c8133f6672a8afa1844/src/main/java/frc/robot/subsystems/DriveSubsystem.java#L43-L75)) | No sensor-sample FPGA timestamp API was verified. Capture heading/module positions and `Timer.getFPGATimestamp()` in the same estimator update. |
| WPILib ADXRS450 | `getRotation2d()`, `getAngle()`, `getRate()`, and `reset()` are present. ([ADXRS450 Javadoc](https://github.wpilib.org/allwpilib/docs/release/java/edu/wpi/first/wpilibj/ADXRS450_Gyro.html)) | No sensor-sample FPGA timestamp API was verified. Use the loop's FPGA timestamp for the cached estimator state. |
| Redux Canandgyro | `getRotation2d()` provides yaw; `getYawFrame().getFrameData()` and the angular-position/velocity frames expose value and FPGA-relative timestamp atomically. ([Canandgyro 2026.1.2](https://github.com/Redux-Robotics/canandrepo-public/blob/reduxlib-v2026.1.2/ReduxLib/src/main/java/com/reduxrobotics/sensors/canandgyro/Canandgyro.java#L165-L201), [timestamped frames](https://github.com/Redux-Robotics/canandrepo-public/blob/reduxlib-v2026.1.2/ReduxLib/src/main/java/com/reduxrobotics/frames/Frame.java#L173-L207)) | Prefer `getFrameData()` over separate value/timestamp reads. Estimator reset should use a software offset unless the team intentionally commands a hardware zero outside Bordeaux. |
| Studica NavX3 | The 2026 example constructs `new Navx(0, 100)` for CAN, reads `getYaw().in(Degrees)` and `getAngularVel()`, and calls `resetYaw()`. ([official 2026 example](https://github.com/Studica-Robotics/NavX/blob/b70592e03bbf285f22302cebc837962bc0f2fa16/Example%20Projects/NavX3-java/src/main/java/frc/robot/Robot.java#L38-L101), [reset example](https://github.com/Studica-Robotics/NavX/blob/b70592e03bbf285f22302cebc837962bc0f2fa16/Example%20Projects/NavX3-java/src/main/java/frc/robot/Robot.java#L124-L133)) | No FPGA sample-timestamp call was verified. Cache it at the estimator loop time. `com.studica.frc.Navx` is distinct from the legacy KauaiLabs `AHRS` API. |
| Legacy KauaiLabs navX `AHRS` | The first-party source exposes `getYaw()`, `getRate()`, `reset()`, and `getLastSensorTimestamp()`; that timestamp is unavailable for serial transports. ([legacy AHRS source](https://github.com/kauailabs/navxmxp/blob/5e010ba810bb7f7eaab597e0b708e34f159984db/roborio/java/navx_frc/src/com/kauailabs/navx/frc/AHRS.java#L402-L426), [legacy timestamp source](https://github.com/kauailabs/navxmxp/blob/5e010ba810bb7f7eaab597e0b708e34f159984db/roborio/java/navx_frc/src/com/kauailabs/navx/frc/AHRS.java#L595-L615)) | No maintained FRC 2026 KauaiLabs artifact was verified. Keep this as a clearly labeled legacy snippet, not a supported 2026 template. The sensor timestamp's conversion to FPGA seconds was not verified, so do not pass it to Bordeaux unchanged. |

## Vision normalization

Every vision example should drain all new frames, reject disconnected/untracked/no-tag/non-finite results, preserve the supplied capture/reception timestamp, calculate documented uncertainty, and then construct one `BordeauxVisionObservation(sourceId, pose, timestamp, xStdDev, yStdDev, headingStdDev)`. The current Bordeaux record requires all three standard deviations to be finite and positive. ([Bordeaux vision validation](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxVisionObservation.java))

### PhotonVision

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
