package dev.bordeaux.examples.drive;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.bordeaux.runtime.BordeauxDriveLimits;
import dev.bordeaux.runtime.BordeauxDriveState;
import dev.bordeaux.runtime.BordeauxVisionObservation;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class DriveExamplesTest {
    @Test
    void publishesOneAtomicEstimatorSnapshot() {
        var cache = new AtomicDriveStateCache(
                new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 0));
        var pose = new Pose2d(2, 3, Rotation2d.fromDegrees(20));
        var speeds = new ChassisSpeeds(1, -0.25, 0.5);

        cache.update(pose, speeds, 14.2);

        assertEquals(new BordeauxDriveState(pose, speeds, 14.2), cache.state());
    }

    @Test
    void delegatesTheCompleteDriveContract() {
        var swerve = new StubSwerve();
        var drive = MethodReferenceDriveAdapter.withVision(
                swerve, new BordeauxDriveLimits(4, 6, 8, 12));

        assertSame(swerve, drive.requirement());
        assertSame(swerve.state.get(), drive.state());

        var request = new ChassisSpeeds(2, 1, 0.5);
        drive.driveRobotRelative(request);
        assertEquals(request.vxMetersPerSecond, swerve.output.get().vxMetersPerSecond);
        assertEquals(request.vyMetersPerSecond, swerve.output.get().vyMetersPerSecond);
        assertEquals(request.omegaRadiansPerSecond, swerve.output.get().omegaRadiansPerSecond);

        var reset = new Pose2d(1, 2, Rotation2d.fromDegrees(30));
        drive.resetPose(reset);
        assertEquals(reset, swerve.reset.get());

        var observation = new BordeauxVisionObservation("front", reset, 2, 0.1, 0.1, 0.2);
        drive.addVisionMeasurement(observation);
        assertSame(observation, swerve.vision.get());

        drive.stop();
        assertTrue(swerve.stopped);
        assertThrows(IllegalArgumentException.class,
                () -> drive.driveRobotRelative(new ChassisSpeeds(4, 4, 0)));
    }

    private static final class StubSwerve implements Subsystem, MethodReferenceDriveAdapter.ExistingSwerve {
        private final AtomicReference<BordeauxDriveState> state = new AtomicReference<>(
                new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 1));
        private final AtomicReference<ChassisSpeeds> output = new AtomicReference<>();
        private final AtomicReference<Pose2d> reset = new AtomicReference<>();
        private final AtomicReference<BordeauxVisionObservation> vision = new AtomicReference<>();
        private boolean stopped;

        @Override
        public Subsystem requirement() {
            return this;
        }

        @Override
        public BordeauxDriveState bordeauxState() {
            return state.get();
        }

        @Override
        public void driveRobotRelative(ChassisSpeeds speeds) {
            output.set(speeds);
        }

        @Override
        public void resetPose(Pose2d pose) {
            reset.set(pose);
        }

        @Override
        public void addVisionMeasurement(BordeauxVisionObservation observation) {
            vision.set(observation);
        }

        @Override
        public void stop() {
            stopped = true;
        }
    }
}
