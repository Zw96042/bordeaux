package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class BordeauxDriveAdapterTest {
    @Test
    void wrapsAnExistingDrivetrainWithMethodReferences() {
        Subsystem subsystem = new Subsystem() {};
        AtomicReference<Pose2d> pose = new AtomicReference<>(new Pose2d(1, 2, Rotation2d.fromDegrees(30)));
        AtomicReference<ChassisSpeeds> measured = new AtomicReference<>(new ChassisSpeeds(1, -0.5, 0.25));
        AtomicReference<ChassisSpeeds> output = new AtomicReference<>();
        AtomicReference<BordeauxVisionObservation> vision = new AtomicReference<>();
        boolean[] stopped = {false};
        BordeauxDriveLimits limits = new BordeauxDriveLimits(4.8, 7, 9, 18);

        BordeauxDrive drive = BordeauxDriveAdapter.forSubsystem(subsystem)
                .state(() -> new BordeauxDriveState(pose.get(), measured.get(), 12.5))
                .output(output::set)
                .resetPose(pose::set)
                .visionMeasurement(vision::set)
                .stop(() -> stopped[0] = true)
                .limits(limits)
                .build();

        assertSame(subsystem, drive.requirement());
        BordeauxDriveState state = drive.state();
        assertEquals(new BordeauxDriveState(pose.get(), measured.get(), 12.5), state);
        ChassisSpeeds mutableCopy = state.robotRelativeSpeeds();
        mutableCopy.vxMetersPerSecond = 99;
        assertEquals(1, state.robotRelativeSpeeds().vxMetersPerSecond);
        assertEquals(limits, drive.limits());

        ChassisSpeeds request = new ChassisSpeeds(2, 1, -0.5);
        drive.driveRobotRelative(request);
        assertNotSame(request, output.get());
        assertEquals(request.vxMetersPerSecond, output.get().vxMetersPerSecond);
        assertEquals(request.vyMetersPerSecond, output.get().vyMetersPerSecond);
        assertEquals(request.omegaRadiansPerSecond, output.get().omegaRadiansPerSecond);

        Pose2d reset = new Pose2d(3, 4, Rotation2d.fromDegrees(-20));
        drive.resetPose(reset);
        assertEquals(reset, pose.get());

        BordeauxVisionObservation observation = new BordeauxVisionObservation(
                "front", new Pose2d(3.1, 3.9, Rotation2d.fromDegrees(-19)), 12.3, 0.1, 0.1, 0.2);
        assertTrue(drive.acceptsVisionMeasurements());
        drive.addVisionMeasurement(observation);
        assertSame(observation, vision.get());

        drive.stop();
        assertTrue(stopped[0]);
    }

    @Test
    void rejectsInvalidStateAndUnsafeOutputsAtTheAdapterBoundary() {
        AtomicReference<ChassisSpeeds> output = new AtomicReference<>();
        BordeauxDrive drive = BordeauxDriveAdapter.forSubsystem(new Subsystem() {})
                .state(() -> new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 0))
                .output(output::set)
                .resetPose(pose -> {})
                .stop(() -> {})
                .limits(new BordeauxDriveLimits(4, 6, 8, 10))
                .build();

        assertFalse(drive.acceptsVisionMeasurements());
        assertThrows(UnsupportedOperationException.class,
                () -> drive.addVisionMeasurement(new BordeauxVisionObservation(
                        "camera", new Pose2d(), 0, 1, 1, 1)));
        assertThrows(IllegalArgumentException.class,
                () -> drive.driveRobotRelative(new ChassisSpeeds(4, 4, 0)));
        assertThrows(IllegalArgumentException.class,
                () -> drive.driveRobotRelative(new ChassisSpeeds(0, 0, Double.NaN)));
        assertNull(output.get());

        assertThrows(IllegalArgumentException.class,
                () -> new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), -1));
        assertThrows(IllegalArgumentException.class,
                () -> new BordeauxVisionObservation("camera", new Pose2d(), 0, 0, 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new BordeauxVisionObservation("front\ncamera", new Pose2d(), 0, 1, 1, 1));
    }

    @Test
    void reportsMissingRequiredBuilderCallbacksBeforeConstruction() {
        NullPointerException failure = assertThrows(NullPointerException.class,
                () -> BordeauxDriveAdapter.forSubsystem(new Subsystem() {}).build());

        assertEquals("state", failure.getMessage());
    }

    @Test
    void acceptsOneRobotOwnedAtomicStateCallback() {
        BordeauxDriveState expected = new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 4.2);
        BordeauxDrive drive = BordeauxDriveAdapter.forSubsystem(new Subsystem() {})
                .state(() -> expected)
                .output(speeds -> {})
                .resetPose(pose -> {})
                .stop(() -> {})
                .limits(new BordeauxDriveLimits(4, 6, 8, 10))
                .build();

        assertSame(expected, drive.state());
    }
}
