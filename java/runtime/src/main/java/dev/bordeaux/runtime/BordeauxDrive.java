package dev.bordeaux.runtime;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;

/** Vendor-neutral robot seam for adapters today and the staged command-returning motion runtime. */
public interface BordeauxDrive {
    /** The WPILib requirement a robot-owned or future Bordeaux motion command must hold. */
    Subsystem requirement();

    /** Returns pose and measured robot-relative speeds from the same control iteration. */
    BordeauxDriveState state();

    BordeauxDriveLimits limits();

    /** Accepts one finite, limits-checked robot-relative request. */
    void driveRobotRelative(ChassisSpeeds speeds);

    /** Resets the estimator pose; implementations must not silently zero physical IMU hardware. */
    void resetPose(Pose2d pose);

    boolean acceptsVisionMeasurements();

    /** Delivers an observation to the same estimator that supplies {@link #state()}. */
    void addVisionMeasurement(BordeauxVisionObservation observation);

    /** Immediately commands a safe zero-output state. */
    void stop();
}
