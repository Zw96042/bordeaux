package dev.bordeaux.examples.drive;

import dev.bordeaux.runtime.BordeauxDrive;
import dev.bordeaux.runtime.BordeauxDriveAdapter;
import dev.bordeaux.runtime.BordeauxDriveLimits;
import dev.bordeaux.runtime.BordeauxDriveState;
import dev.bordeaux.runtime.BordeauxVisionObservation;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;
import java.util.Objects;

/** Copyable adapter for CTRE, YAGSL, REV, or a team-owned swerve subsystem. */
public final class MethodReferenceDriveAdapter {
    private MethodReferenceDriveAdapter() {}

    /** The six operations Bordeaux needs from an existing drivetrain. */
    public interface ExistingSwerve {
        Subsystem requirement();

        BordeauxDriveState bordeauxState();

        void driveRobotRelative(ChassisSpeeds speeds);

        void resetPose(Pose2d pose);

        void addVisionMeasurement(BordeauxVisionObservation observation);

        void stop();
    }

    public static BordeauxDrive withVision(ExistingSwerve drivetrain, BordeauxDriveLimits limits) {
        Objects.requireNonNull(drivetrain, "drivetrain");
        return BordeauxDriveAdapter.forSubsystem(drivetrain.requirement())
                .state(drivetrain::bordeauxState)
                .output(drivetrain::driveRobotRelative)
                .resetPose(drivetrain::resetPose)
                .visionMeasurement(drivetrain::addVisionMeasurement)
                .stop(drivetrain::stop)
                .limits(limits)
                .build();
    }

    public static BordeauxDrive withoutVision(ExistingSwerve drivetrain, BordeauxDriveLimits limits) {
        Objects.requireNonNull(drivetrain, "drivetrain");
        return BordeauxDriveAdapter.forSubsystem(drivetrain.requirement())
                .state(drivetrain::bordeauxState)
                .output(drivetrain::driveRobotRelative)
                .resetPose(drivetrain::resetPose)
                .stop(drivetrain::stop)
                .limits(limits)
                .build();
    }
}
