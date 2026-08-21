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
