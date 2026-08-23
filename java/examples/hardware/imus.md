# IMUs

An IMU normally feeds the estimator that produces `BordeauxDriveState`; Bordeaux should not run a
second heading estimate beside CTRE, YAGSL, or the team's WPILib estimator. A `resetPose` callback
changes the estimator's field pose. It must not silently zero physical IMU hardware.

## Selection matrix

| IMU | Current Java surface | Bordeaux integration status |
| --- | --- | --- |
| CTRE Pigeon 2 | `getRotation2d`, timestamped status signals | Phoenix 6 API verified |
| WPILib ADIS16470 | `getAngle(axis)`, `getRate(axis)` | Compile-checked against WPILib 2026.2.2 |
| WPILib ADXRS450 | `getRotation2d`, `getAngle`, `getRate` | Compile-checked against WPILib 2026.2.2 |
| Redux Canandgyro | `getRotation2d`, timestamped frames | ReduxLib 2026.1.2 source verified |
| Studica NavX3 | `Navx`, unit-safe yaw and angular velocity | StudicaLib 2026.0.2 source verified |
| Legacy KauaiLabs navX/navX2 | `AHRS` | Legacy only; no maintained 2026 artifact verified |
| Any other IMU | `Rotation2d` plus the estimator loop's FPGA time | Vendor-neutral pattern |

## Pigeon 2

When using CTRE's swerve drivetrain, take heading from the drivetrain's own atomic state; do not poll
the Pigeon a second time for Bordeaux. A custom WPILib estimator can use:

```java
Rotation2d heading = pigeon.getRotation2d();
```

For high-rate custom odometry, refresh `getYaw()`/`getAngularVelocityZWorld()` status signals and use
their signal timestamp rather than assigning a later robot-loop time. CTRE documents Pigeon status
signals in its [status-signal guide](https://v6.docs.ctr-electronics.com/en/docs-2026-beta/docs/api-reference/status-signals.html#pigeon-2-signals).
If converting a Phoenix timestamp into Bordeaux state, use `Utils.currentTimeToFPGATime(...)`.

## ADIS16470 and ADXRS450 — compile-checked

[`WpilibImuHeadings`](../src/main/java/dev/bordeaux/examples/imu/WpilibImuHeadings.java) keeps the
ADIS yaw axis and sign explicit and uses the WPILib-native rotation for ADXRS450:

```java
Rotation2d adisHeading = WpilibImuHeadings.fromAdis16470(
    adis, ADIS16470_IMU.IMUAxis.kZ, SENSOR_ANGLE_IS_CLOCKWISE_POSITIVE);
Rotation2d adxrsHeading = WpilibImuHeadings.fromAdxrs450(adxrs);
```

Neither verified class exposes an FPGA capture timestamp for an individual sample. Read heading,
module positions, and `Timer.getFPGATimestamp()` together in the estimator update. See the official
[`ADIS16470_IMU`](https://github.wpilib.org/allwpilib/docs/release/java/edu/wpi/first/wpilibj/ADIS16470_IMU.html)
and [`ADXRS450_Gyro`](https://github.wpilib.org/allwpilib/docs/release/java/edu/wpi/first/wpilibj/ADXRS450_Gyro.html)
Javadocs.

## Redux Canandgyro — 2026 source verified

The low-rate form is ordinary WPILib geometry:

```java
Rotation2d heading = canandgyro.getRotation2d();
```

For synchronized odometry, use `canandgyro.getYawFrame().getFrameData()` so value and timestamp come
from the same frame; do not read the yaw and timestamp separately. Redux's 2026.1.2
[`Canandgyro` source](https://github.com/Redux-Robotics/canandrepo-public/blob/reduxlib-v2026.1.2/ReduxLib/src/main/java/com/reduxrobotics/sensors/canandgyro/Canandgyro.java#L165-L201)
and [`Frame` contract](https://github.com/Redux-Robotics/canandrepo-public/blob/reduxlib-v2026.1.2/ReduxLib/src/main/java/com/reduxrobotics/frames/Frame.java#L173-L207)
document the FPGA-relative frame data. The device is CAN 2.0B, not CAN-FD; Redux publishes its
[2026 vendordep](https://frcsdk.reduxrobotics.com/ReduxLib_2026.json).

## Studica NavX3 — 2026 source verified

Studica's current CAN API is `com.studica.frc.Navx`, which is distinct from the older KauaiLabs
`AHRS` class:

```java
Navx navx = new Navx(0, 100);
Rotation2d heading = Rotation2d.fromDegrees(navx.getYaw().in(Degrees));
double angularVelocityDegreesPerSecond = navx.getAngularVel()[2].in(DegreesPerSecond);
```

The official [NavX3 Java example](https://github.com/Studica-Robotics/NavX/blob/b70592e03bbf285f22302cebc837962bc0f2fa16/Example%20Projects/NavX3-java/src/main/java/frc/robot/Robot.java#L38-L101)
uses those calls. No sample-level FPGA timestamp was verified, so capture it in the same estimator
loop. Hardware `resetYaw()` is an explicit team action, not the implementation of Bordeaux
`resetPose`.

## Legacy KauaiLabs navX/navX2

Existing robots can continue feeding an `AHRS` heading into their estimator. The first-party legacy
source has `getYaw`, `getRate`, `reset`, and `getLastSensorTimestamp`, but the sensor timestamp is
unavailable on serial transports and its conversion to FPGA seconds was not verified. Keep the team's
existing, tested clock conversion or use the estimator-loop FPGA timestamp; do not pass the raw sensor
timestamp to Bordeaux. No maintained FRC 2026 KauaiLabs artifact was found, so this is a migration
recipe rather than a new-project recommendation. See the
[`AHRS` source](https://github.com/kauailabs/navxmxp/blob/5e010ba810bb7f7eaab597e0b708e34f159984db/roborio/java/navx_frc/src/com/kauailabs/navx/frc/AHRS.java#L402-L426).

## Generic estimator loop

Whichever IMU is selected, publish one state only after the estimator update:

```java
double timestampS = Timer.getFPGATimestamp();
Pose2d correctedPose = poseEstimator.updateWithTime(timestampS, heading, modulePositions);
stateCache.update(correctedPose, kinematics.toChassisSpeeds(moduleStates), timestampS);
```

If the hardware supplies a more accurate source timestamp, use it consistently for the IMU and module
samples and interpolate before estimator update. Do not combine measurements from different times
under one newly invented timestamp.
