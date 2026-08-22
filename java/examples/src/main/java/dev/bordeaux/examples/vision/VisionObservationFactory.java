package dev.bordeaux.examples.vision;

import dev.bordeaux.runtime.BordeauxVisionObservation;
import edu.wpi.first.math.geometry.Pose2d;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Predicate;

/** Normalizes camera results before they cross the Bordeaux drivetrain boundary. */
public final class VisionObservationFactory {
    private VisionObservationFactory() {}

    public static BordeauxVisionObservation fromCaptureTimestamp(
            String cameraId,
            Pose2d fieldPose,
            double captureTimestampS,
            double translationStdDevM,
            double headingStdDevRad) {
        return new BordeauxVisionObservation(
                cameraId,
                fieldPose,
                captureTimestampS,
                translationStdDevM,
                translationStdDevM,
                headingStdDevRad);
    }

    /** Filters untrusted camera output without throwing on the robot loop. */
    public static Optional<BordeauxVisionObservation> tryFromCaptureTimestamp(
            String cameraId,
            Pose2d fieldPose,
            double captureTimestampS,
            double xStdDevM,
            double yStdDevM,
            double headingStdDevRad,
            Predicate<Pose2d> isInsideField) {
        Objects.requireNonNull(isInsideField, "isInsideField");
        if (!validSourceId(cameraId)
                || !finitePose(fieldPose)
                || !Double.isFinite(captureTimestampS)
                || captureTimestampS < 0
                || !positiveFinite(xStdDevM)
                || !positiveFinite(yStdDevM)
                || !positiveFinite(headingStdDevRad)
                || !isInsideField.test(fieldPose)) {
            return Optional.empty();
        }
        return Optional.of(new BordeauxVisionObservation(
                cameraId,
                fieldPose,
                captureTimestampS,
                xStdDevM,
                yStdDevM,
                headingStdDevRad));
    }

    /** For APIs that report total latency instead of an absolute FPGA capture timestamp. */
    public static BordeauxVisionObservation fromLatency(
            String cameraId,
            Pose2d fieldPose,
            double receivedAtFpgaTimestampS,
            double totalLatencyS,
            double translationStdDevM,
            double headingStdDevRad) {
        if (!Double.isFinite(totalLatencyS) || totalLatencyS < 0
                || totalLatencyS > receivedAtFpgaTimestampS) {
            throw new IllegalArgumentException("totalLatencyS must fit within the FPGA receipt timestamp");
        }
        return fromCaptureTimestamp(
                cameraId,
                fieldPose,
                receivedAtFpgaTimestampS - totalLatencyS,
                translationStdDevM,
                headingStdDevRad);
    }

    private static boolean finitePose(Pose2d pose) {
        return pose != null
                && Double.isFinite(pose.getX())
                && Double.isFinite(pose.getY())
                && Double.isFinite(pose.getRotation().getRadians());
    }

    private static boolean positiveFinite(double value) {
        return Double.isFinite(value) && value > 0;
    }

    private static boolean validSourceId(String sourceId) {
        return sourceId != null
                && !sourceId.isBlank()
                && sourceId.length() <= 128
                && sourceId.codePoints().noneMatch(Character::isISOControl);
    }
}
