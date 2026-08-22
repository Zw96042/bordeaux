package dev.bordeaux.examples.drive;

import dev.bordeaux.runtime.BordeauxDriveState;
import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.math.kinematics.ChassisSpeeds;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

/** Publishes pose, measured speeds, and their source timestamp as one indivisible snapshot. */
public final class AtomicDriveStateCache {
    private final AtomicReference<BordeauxDriveState> latest;

    public AtomicDriveStateCache(BordeauxDriveState initialState) {
        latest = new AtomicReference<>(Objects.requireNonNull(initialState, "initialState"));
    }

    /** Call once from the drivetrain's estimator update, using values from that same update. */
    public void update(Pose2d pose, ChassisSpeeds robotRelativeSpeeds, double sourceTimestampS) {
        latest.set(new BordeauxDriveState(pose, robotRelativeSpeeds, sourceTimestampS));
    }

    public BordeauxDriveState state() {
        return latest.get();
    }
}
