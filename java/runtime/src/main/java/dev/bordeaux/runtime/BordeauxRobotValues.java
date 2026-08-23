package dev.bordeaux.runtime;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import java.util.Objects;

final class BordeauxRobotValues {
    private BordeauxRobotValues() {}

    static Pose2d requireFinitePose(Pose2d pose, String name) {
        Objects.requireNonNull(pose, name);
        if (!Double.isFinite(pose.getX()) || !Double.isFinite(pose.getY())
                || !Double.isFinite(pose.getRotation().getRadians())) {
            throw new IllegalArgumentException(name + " must be finite");
        }
        return pose;
    }

    static ChassisSpeeds requireFiniteSpeeds(ChassisSpeeds speeds, String name) {
        Objects.requireNonNull(speeds, name);
        if (!Double.isFinite(speeds.vxMetersPerSecond)
                || !Double.isFinite(speeds.vyMetersPerSecond)
                || !Double.isFinite(speeds.omegaRadiansPerSecond)) {
            throw new IllegalArgumentException(name + " must be finite");
        }
        return speeds;
    }

    static double requireNonnegativeFinite(double value, String name) {
        if (!Double.isFinite(value) || value < 0) {
            throw new IllegalArgumentException(name + " must be finite and nonnegative");
        }
        return value;
    }

    static double requirePositiveFinite(double value, String name) {
        if (!Double.isFinite(value) || value <= 0) {
            throw new IllegalArgumentException(name + " must be finite and positive");
        }
        return value;
    }
}
