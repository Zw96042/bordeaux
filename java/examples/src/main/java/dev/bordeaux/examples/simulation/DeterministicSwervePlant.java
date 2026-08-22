package dev.bordeaux.examples.simulation;

import dev.bordeaux.runtime.BordeauxDrive;
import dev.bordeaux.runtime.BordeauxDriveAdapter;
import dev.bordeaux.runtime.BordeauxDriveLimits;
import dev.bordeaux.runtime.BordeauxDriveState;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.geometry.Rotation2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;

/** Fixed-step first-order plant for repeatable adapter and controller tests, not robot physics. */
public final class DeterministicSwervePlant implements Subsystem {
    private BordeauxDriveState state =
            new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 0);
    private ChassisSpeeds request = new ChassisSpeeds();

    public BordeauxDrive drive(BordeauxDriveLimits limits) {
        return BordeauxDriveAdapter.forSubsystem(this)
                .state(this::state)
                .output(this::accept)
                .resetPose(this::resetPose)
                .stop(this::stop)
                .limits(limits)
                .build();
    }

    public BordeauxDriveState state() {
        return state;
    }

    public ChassisSpeeds request() {
        return new ChassisSpeeds(
                request.vxMetersPerSecond,
                request.vyMetersPerSecond,
                request.omegaRadiansPerSecond);
    }

    public void step(double dtS) {
        if (!Double.isFinite(dtS) || dtS <= 0) {
            throw new IllegalArgumentException("dtS must be positive and finite");
        }
        Pose2d pose = state.pose();
        double heading = pose.getRotation().getRadians();
        double fieldVelocityX = request.vxMetersPerSecond * Math.cos(heading)
                - request.vyMetersPerSecond * Math.sin(heading);
        double fieldVelocityY = request.vxMetersPerSecond * Math.sin(heading)
                + request.vyMetersPerSecond * Math.cos(heading);
        var nextPose = new Pose2d(
                pose.getX() + fieldVelocityX * dtS,
                pose.getY() + fieldVelocityY * dtS,
                new Rotation2d(heading + request.omegaRadiansPerSecond * dtS));
        state = new BordeauxDriveState(nextPose, request, state.timestampS() + dtS);
    }

    private void accept(ChassisSpeeds speeds) {
        request = new ChassisSpeeds(
                speeds.vxMetersPerSecond,
                speeds.vyMetersPerSecond,
                speeds.omegaRadiansPerSecond);
    }

    private void resetPose(Pose2d pose) {
        state = new BordeauxDriveState(pose, request, state.timestampS());
    }

    private void stop() {
        request = new ChassisSpeeds();
    }
}
