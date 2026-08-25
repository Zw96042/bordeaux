package dev.bordeaux.runtime;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import edu.wpi.first.wpilibj2.command.Subsystem;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Method-reference adapter for an existing team-owned drivetrain and pose estimator. */
public final class BordeauxDriveAdapter implements BordeauxDrive {
    private static final double LIMIT_EPSILON = 1e-9;

    private final Subsystem requirement;
    private final Supplier<BordeauxDriveState> state;
    private final Consumer<ChassisSpeeds> output;
    private final Consumer<Pose2d> resetPose;
    private final Consumer<BordeauxVisionObservation> visionMeasurement;
    private final Runnable stop;
    private final BordeauxDriveLimits limits;

    private BordeauxDriveAdapter(Builder builder) {
        requirement = builder.requirement;
        state = builder.state;
        output = builder.output;
        resetPose = builder.resetPose;
        visionMeasurement = builder.visionMeasurement;
        stop = builder.stop;
        limits = builder.limits;
    }

    public static Builder forSubsystem(Subsystem requirement) {
        return new Builder(requirement);
    }

    @Override
    public Subsystem requirement() {
        return requirement;
    }

    @Override
    public BordeauxDriveState state() {
        return Objects.requireNonNull(state.get(), "state callback result");
    }

    @Override
    public BordeauxDriveLimits limits() {
        return limits;
    }

    @Override
    public void driveRobotRelative(ChassisSpeeds speeds) {
        BordeauxRobotValues.requireFiniteSpeeds(speeds, "speeds");
        double linearVelocity = Math.hypot(speeds.vxMetersPerSecond, speeds.vyMetersPerSecond);
        if (linearVelocity > limits.maxLinearVelocityMps() + LIMIT_EPSILON
                || Math.abs(speeds.omegaRadiansPerSecond) > limits.maxAngularVelocityRadps() + LIMIT_EPSILON) {
            throw new IllegalArgumentException("speeds exceed the configured Bordeaux drive limits");
        }
        output.accept(new ChassisSpeeds(
                speeds.vxMetersPerSecond, speeds.vyMetersPerSecond, speeds.omegaRadiansPerSecond));
    }

    @Override
    public void resetPose(Pose2d pose) {
        resetPose.accept(BordeauxRobotValues.requireFinitePose(pose, "pose"));
    }

    @Override
    public boolean acceptsVisionMeasurements() {
        return visionMeasurement != null;
    }

    @Override
    public void addVisionMeasurement(BordeauxVisionObservation observation) {
        Objects.requireNonNull(observation, "observation");
        if (visionMeasurement == null) {
            throw new UnsupportedOperationException(
                    "This Bordeaux drive adapter was built without a visionMeasurement callback");
        }
        visionMeasurement.accept(observation);
    }

    @Override
    public void stop() {
        stop.run();
    }

    public static final class Builder {
        private final Subsystem requirement;
        private Supplier<BordeauxDriveState> state;
        private Consumer<ChassisSpeeds> output;
        private Consumer<Pose2d> resetPose;
        private Consumer<BordeauxVisionObservation> visionMeasurement;
        private Runnable stop;
        private BordeauxDriveLimits limits;

        private Builder(Subsystem requirement) {
            this.requirement = Objects.requireNonNull(requirement, "requirement");
        }

        /** Supplies one robot-owned pose, speed, and source-timestamp snapshot. */
        public Builder state(Supplier<BordeauxDriveState> state) {
            this.state = Objects.requireNonNull(state, "state");
            return this;
        }

        public Builder output(Consumer<ChassisSpeeds> output) {
            this.output = Objects.requireNonNull(output, "output");
            return this;
        }

        public Builder resetPose(Consumer<Pose2d> resetPose) {
            this.resetPose = Objects.requireNonNull(resetPose, "resetPose");
            return this;
        }

        /** Enables normalized vision delivery to the team-owned estimator. */
        public Builder visionMeasurement(Consumer<BordeauxVisionObservation> visionMeasurement) {
            this.visionMeasurement = Objects.requireNonNull(visionMeasurement, "visionMeasurement");
            return this;
        }

        public Builder stop(Runnable stop) {
            this.stop = Objects.requireNonNull(stop, "stop");
            return this;
        }

        public Builder limits(BordeauxDriveLimits limits) {
            this.limits = Objects.requireNonNull(limits, "limits");
            return this;
        }

        public BordeauxDriveAdapter build() {
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(output, "output");
            Objects.requireNonNull(resetPose, "resetPose");
            Objects.requireNonNull(stop, "stop");
            Objects.requireNonNull(limits, "limits");
            return new BordeauxDriveAdapter(this);
        }
    }
}
