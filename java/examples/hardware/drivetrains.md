
## CTRE Phoenix 6 swerve — vendor API verified

Phoenix 6 already supplies an atomic `SwerveDriveState` with pose, robot-centric speed, and a capture
timestamp. Poll its defensive state copy and convert CTRE's clock to FPGA time:

```java
private final SwerveRequest.ApplyRobotSpeeds bordeauxRequest =
    new SwerveRequest.ApplyRobotSpeeds();
private final SwerveRequest.Idle bordeauxIdle = new SwerveRequest.Idle();

var drive = BordeauxDriveAdapter.forSubsystem(drivetrain)
    .state(() -> {
        var state = drivetrain.getStateCopy();
        return new BordeauxDriveState(
            state.Pose,
            state.Speeds,
            Utils.currentTimeToFPGATime(state.Timestamp));
    })
    .output(speeds -> drivetrain.setControl(bordeauxRequest.withSpeeds(speeds)))
    .resetPose(drivetrain::resetPose)
    .visionMeasurement(observation -> drivetrain.addVisionMeasurement(
        observation.fieldPose(),
        Utils.fpgaToCurrentTime(observation.captureTimestampS()),
        VecBuilder.fill(observation.xStdDevM(), observation.yStdDevM(),
            observation.headingStdDevRad())))
    .stop(() -> drivetrain.setControl(bordeauxIdle))
    .limits(ROBOT_LIMITS)
    .build();
```

Phoenix exposes one telemetry callback slot. Do not call `registerTelemetry` solely for Bordeaux or a
later registration can replace the generated project's logger. If the robot already owns that one
callback, update a non-null Bordeaux cache inside it alongside the existing telemetry work; otherwise
use `getStateCopy()` as above. Do not poll split getters or invent a new timestamp. CTRE documents the
state fields and clock conversion in its
[`SwerveDriveState` API](https://api.ctr-electronics.com/phoenix6/stable/java/com/ctre/phoenix6/swerve/SwerveDrivetrain.SwerveDriveState.html),
the autonomous-oriented request in
[`ApplyRobotSpeeds`](https://api.ctr-electronics.com/phoenix6/stable/java/com/ctre/phoenix6/swerve/SwerveRequest.ApplyRobotSpeeds.html),
and estimator/vision behavior in
[`SwerveDrivetrain`](https://api.ctr-electronics.com/phoenix6/stable/java/com/ctre/phoenix6/swerve/SwerveDrivetrain.html).

This works with the Phoenix generator's supported drive, steer, and encoder device combinations. The
module order and force-feedforward expansion remain CTRE-owned.

## YAGSL — source API verified; 2026 artifact not verified

Capture the values once immediately after the odometry update instead of having Bordeaux call
`getPose()` and `getRobotVelocity()` independently:

```java
private final AtomicDriveStateCache bordeauxState = new AtomicDriveStateCache(
    new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 0));

@Override
public void periodic() {
    swerveDrive.updateOdometry(); // omit if your selected YAGSL threading mode owns this call
    bordeauxState.update(
        swerveDrive.getPose(),
        swerveDrive.getRobotVelocity(),
        Timer.getFPGATimestamp());
}

var drive = BordeauxDriveAdapter.forSubsystem(this)
    .state(bordeauxState::state)
    .output(swerveDrive::setChassisSpeeds)
    .resetPose(swerveDrive::resetOdometry)
    .visionMeasurement(observation -> swerveDrive.addVisionMeasurement(
        observation.fieldPose(), observation.captureTimestampS(),
        VecBuilder.fill(observation.xStdDevM(), observation.yStdDevM(),
            observation.headingStdDevRad())))
    .stop(() -> swerveDrive.setChassisSpeeds(new ChassisSpeeds()))
    .limits(ROBOT_LIMITS)
    .build();
```

If YAGSL's odometry thread is enabled, update the cache from the same callback/thread used to publish
its estimator state rather than calling `updateOdometry()` twice. The current API documents
`getPose`, `getRobotVelocity`, `setChassisSpeeds`, `resetOdometry`, supported motor/encoder/IMU
configurations, and vision uncertainty in the official
[`SwerveDrive` reference](https://broncbotz3481.github.io/YAGSL-Lib/docs/swervelib/SwerveDrive.html).
The official rolling [YAGSL vendordep](https://broncbotz3481.github.io/YAGSL-Lib/yagsl/yagsl.json)
still identifies an FRC 2025 artifact as of this research pass, so this recipe is intentionally not
labeled compile-checked for WPILib 2026.

## REV MAXSwerve template — official-template recipe

REV's template exposes module positions, module states, odometry pose, and `setModuleStates`. Add
three small methods to its `DriveSubsystem`:

```java
public ChassisSpeeds getRobotRelativeSpeeds() {
    return DriveConstants.kDriveKinematics.toChassisSpeeds(
        m_frontLeft.getState(), m_frontRight.getState(),
        m_rearLeft.getState(), m_rearRight.getState());
}

public void driveRobotRelative(ChassisSpeeds speeds) {
    setModuleStates(DriveConstants.kDriveKinematics.toSwerveModuleStates(speeds));
}

public void stop() {
    driveRobotRelative(new ChassisSpeeds());
}
```

After its odometry update, publish `getPose()`, `getRobotRelativeSpeeds()`, and the same loop's FPGA
timestamp to `AtomicDriveStateCache`. Use `resetOdometry` for the reset callback. The unmodified REV
template uses `SwerveDriveOdometry`; switch that member to WPILib `SwerveDrivePoseEstimator` before
enabling the Bordeaux vision callback. The source of truth is REV's
[`DriveSubsystem`](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/main/src/main/java/frc/robot/subsystems/DriveSubsystem.java)
and [`MAXSwerveModule`](https://github.com/REVrobotics/MAXSwerve-Java-Template/blob/main/src/main/java/frc/robot/subsystems/MAXSwerveModule.java).

The Bordeaux portion is compile-checked; the additions above are **official-template recipe**, not a
separately pinned REV build in this repository.

## Custom WPILib swerve — compile-checked seam

For any module implementation, calculate measured chassis speed from the actual module states:

```java
ChassisSpeeds measured = kinematics.toChassisSpeeds(
    frontLeft.getState(), frontRight.getState(),
    backLeft.getState(), backRight.getState());
stateCache.update(poseEstimator.getEstimatedPosition(), measured, sampleTimestampS);
```

For output, desaturate after converting the requested chassis speed:

```java
var states = kinematics.toSwerveModuleStates(requestedRobotRelativeSpeeds);
SwerveDriveKinematics.desaturateWheelSpeeds(states, maxModuleSpeedMps);
frontLeft.setDesiredState(states[0]);
frontRight.setDesiredState(states[1]);
backLeft.setDesiredState(states[2]);
backRight.setDesiredState(states[3]);
```

WPILib's maintained examples include both
[`SwerveBot` and `Swerve Drive PoseEstimator`](https://docs.wpilib.org/en/stable/docs/software/examples-tutorials/wpilib-examples.html).

## Module compatibility

No Bordeaux code imports a module brand. A module is compatible when the drivetrain can provide a
measured `SwerveModuleState`/`SwerveModulePosition` and accept a desired state. That includes common
SDS, WCP, REV MAXSwerve, Thrifty, AndyMark, and custom modules using Talon FX, SPARK MAX/Flex, or
another WPILib-capable controller. The robot project remains responsible for gear ratio, wheel radius,
absolute-encoder offset, inversion, current limits, closed-loop gains, and characterization.

Do not adapt at the individual motor level unless the team does not yet have a drivetrain subsystem.
Bordeaux should consume the estimator and output surface the robot already trusts.
