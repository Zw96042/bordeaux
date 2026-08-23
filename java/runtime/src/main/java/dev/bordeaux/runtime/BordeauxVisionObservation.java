package dev.bordeaux.runtime;

import edu.wpi.first.math.geometry.Pose2d;
import java.util.Objects;

/** A vendor-neutral field-pose observation with a capture timestamp in FPGA seconds. */
public record BordeauxVisionObservation(
        String sourceId,
        Pose2d fieldPose,
        double captureTimestampS,
        double xStdDevM,
        double yStdDevM,
        double headingStdDevRad) {
    public BordeauxVisionObservation {
        Objects.requireNonNull(sourceId, "sourceId");
        if (sourceId.isBlank() || sourceId.length() > 128
                || sourceId.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("sourceId must contain 1 to 128 visible characters");
        }
        BordeauxRobotValues.requireFinitePose(fieldPose, "fieldPose");
        BordeauxRobotValues.requireNonnegativeFinite(captureTimestampS, "captureTimestampS");
        BordeauxRobotValues.requirePositiveFinite(xStdDevM, "xStdDevM");
        BordeauxRobotValues.requirePositiveFinite(yStdDevM, "yStdDevM");
        BordeauxRobotValues.requirePositiveFinite(headingStdDevRad, "headingStdDevRad");
    }
}
