package dev.bordeaux.runtime;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;

/** One atomic corrected drivetrain state at an FPGA timestamp. */
public record BordeauxDriveState(
        Pose2d pose,
        double robotRelativeVelocityXMps,
        double robotRelativeVelocityYMps,
        double angularVelocityRadps,
        double timestampS) {
    public BordeauxDriveState(Pose2d pose, ChassisSpeeds robotRelativeSpeeds, double timestampS) {
        this(pose,
                BordeauxRobotValues.requireFiniteSpeeds(robotRelativeSpeeds, "robotRelativeSpeeds").vxMetersPerSecond,
                robotRelativeSpeeds.vyMetersPerSecond,
                robotRelativeSpeeds.omegaRadiansPerSecond,
                timestampS);
    }

    public BordeauxDriveState {
        BordeauxRobotValues.requireFinitePose(pose, "pose");
        if (!Double.isFinite(robotRelativeVelocityXMps) || !Double.isFinite(robotRelativeVelocityYMps)
                || !Double.isFinite(angularVelocityRadps)) {
            throw new IllegalArgumentException("Robot-relative speeds must be finite");
        }
        BordeauxRobotValues.requireNonnegativeFinite(timestampS, "timestampS");
    }

    /** Returns a new mutable WPILib value so this state remains immutable. */
    public ChassisSpeeds robotRelativeSpeeds() {
        return new ChassisSpeeds(
                robotRelativeVelocityXMps, robotRelativeVelocityYMps, angularVelocityRadps);
    }
}
