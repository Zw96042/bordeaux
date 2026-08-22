package dev.bordeaux.examples.imu;

import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.wpilibj.ADIS16470_IMU;
import edu.wpi.first.wpilibj.ADIS16470_IMU.IMUAxis;
import edu.wpi.first.wpilibj.ADXRS450_Gyro;

/** WPILib IMU examples; feed the result into the estimator that owns the Bordeaux drive state. */
public final class WpilibImuHeadings {
    private WpilibImuHeadings() {}

    public static Rotation2d fromAdis16470(
            ADIS16470_IMU imu, IMUAxis yawAxis, boolean sensorAngleIsClockwisePositive) {
        double angleDegrees = imu.getAngle(yawAxis);
        return Rotation2d.fromDegrees(sensorAngleIsClockwisePositive ? -angleDegrees : angleDegrees);
    }

    public static Rotation2d fromAdxrs450(ADXRS450_Gyro gyro) {
        return gyro.getRotation2d();
    }
}
