package dev.bordeaux.examples.vision;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import org.junit.jupiter.api.Test;

class VisionObservationFactoryTest {
    @Test
    void convertsReportedLatencyToAnFpgaCaptureTimestamp() {
        var observation = VisionObservationFactory.fromLatency(
                "rear", new Pose2d(), 20, 0.035, 0.2, 0.5);

        assertEquals(19.965, observation.captureTimestampS(), 1e-12);
        assertEquals(0.2, observation.xStdDevM());
        assertEquals(0.2, observation.yStdDevM());
        assertEquals(0.5, observation.headingStdDevRad());
        assertThrows(IllegalArgumentException.class,
                () -> VisionObservationFactory.fromLatency(
                        "rear", new Pose2d(), 0.01, 0.02, 0.2, 0.5));
    }

    @Test
    void filtersMalformedOrOutOfFieldCameraResultsWithoutThrowing() {
        var valid = VisionObservationFactory.tryFromCaptureTimestamp(
                "front", new Pose2d(2, 3, new Rotation2d()), 10,
                0.1, 0.2, 0.3,
                pose -> pose.getX() <= 16 && pose.getY() <= 8);
        var nonfinite = VisionObservationFactory.tryFromCaptureTimestamp(
                "front", new Pose2d(Double.NaN, 3, new Rotation2d()), 10,
                0.1, 0.2, 0.3, pose -> true);
        var badCovariance = VisionObservationFactory.tryFromCaptureTimestamp(
                "front", new Pose2d(), 10,
                0, 0.2, 0.3, pose -> true);
        var outsideField = VisionObservationFactory.tryFromCaptureTimestamp(
                "front", new Pose2d(17, 3, new Rotation2d()), 10,
                0.1, 0.2, 0.3,
                pose -> pose.getX() <= 16 && pose.getY() <= 8);

        assertTrue(valid.isPresent());
        assertTrue(nonfinite.isEmpty());
        assertTrue(badCovariance.isEmpty());
        assertTrue(outsideField.isEmpty());
    }
}
