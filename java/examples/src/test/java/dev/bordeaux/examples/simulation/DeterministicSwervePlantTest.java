package dev.bordeaux.examples.simulation;

import static org.junit.jupiter.api.Assertions.assertEquals;

import dev.bordeaux.runtime.BordeauxDriveLimits;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import org.junit.jupiter.api.Test;

class DeterministicSwervePlantTest {
    private static final BordeauxDriveLimits LIMITS = new BordeauxDriveLimits(4, 6, 8, 12);

    @Test
    void repeatsCombinedTranslationAndRotationExactly() {
        Pose2d first = runTrace();
        Pose2d second = runTrace();

        assertEquals(first, second);
        assertEquals(2, first.getRotation().getRadians(), 1e-12);
    }

    @Test
    void stopZerosTheAppliedRequest() {
        var plant = new DeterministicSwervePlant();
        var drive = plant.drive(LIMITS);
        drive.driveRobotRelative(new ChassisSpeeds(1, -0.5, 0.25));

        drive.stop();

        assertEquals(0, plant.request().vxMetersPerSecond);
        assertEquals(0, plant.request().vyMetersPerSecond);
        assertEquals(0, plant.request().omegaRadiansPerSecond);
    }

    private static Pose2d runTrace() {
        var plant = new DeterministicSwervePlant();
        var drive = plant.drive(LIMITS);
        drive.driveRobotRelative(new ChassisSpeeds(1, 0.3, 0.5));
        for (int step = 0; step < 200; step++) plant.step(0.02);
        return drive.state().pose();
    }
}
