package dev.bordeaux.examples.generation;

import dev.bordeaux.runtime.BordeauxRoutineProgress;
import dev.bordeaux.runtime.BordeauxRoutineRunner;
import dev.bordeaux.runtime.BordeauxSample;
import java.util.List;
import java.util.Objects;

/** Caller-driven bridge from Aquitaine progress to a robot-owned static/generated trajectory follower. */
public final class AquitaineRoutineLoop implements AutoCloseable {
    public interface MotionFollower {
        void startPath(String pathId);

        void startGenerated(String nodeId, List<BordeauxSample> samples);

        default void periodic() {}

        boolean isFinished();

        void stop();
    }

    private final BordeauxRoutineRunner runner;
    private final MotionFollower follower;
    private String activeMotionId;
    private boolean activeMotionGenerated;
    private boolean started;
    private boolean followerStopped;
    private BordeauxRoutineProgress terminal;

    public AquitaineRoutineLoop(BordeauxRoutineRunner runner, MotionFollower follower) {
        this.runner = Objects.requireNonNull(runner, "runner");
        this.follower = Objects.requireNonNull(follower, "follower");
    }

    public BordeauxRoutineProgress start() {
        if (started) throw new IllegalStateException("Aquitaine routine already started");
        started = true;
        return dispatch(runner.startProgress());
    }

    /** Call once from the robot's normal periodic loop. */
    public BordeauxRoutineProgress periodic() {
        if (!started) throw new IllegalStateException("Call start() before periodic()");
        if (terminal != null) return terminal;
        if (activeMotionId == null) return dispatch(runner.periodic());
        follower.periodic();
        if (!follower.isFinished()) return activeProgress();

        stopFollower();
        String completedId = activeMotionId;
        boolean generated = activeMotionGenerated;
        activeMotionId = null;
        activeMotionGenerated = false;
        return dispatch(generated
                ? runner.completeGeneratedTrajectoryProgress(completedId)
                : runner.completePathProgress(completedId));
    }

    private BordeauxRoutineProgress dispatch(BordeauxRoutineProgress progress) {
        if (progress instanceof BordeauxRoutineProgress.Path path) {
            activeMotionId = path.pathId();
            activeMotionGenerated = false;
            followerStopped = false;
            follower.startPath(path.pathId());
        } else if (progress instanceof BordeauxRoutineProgress.GeneratedTrajectory generated) {
            activeMotionId = generated.nodeId();
            activeMotionGenerated = true;
            followerStopped = false;
            follower.startGenerated(generated.nodeId(), generated.samples());
        } else if (progress instanceof BordeauxRoutineProgress.SafeStopped) {
            // BordeauxGeneratedTrajectorySafety already invoked the robot-owned stop callback.
            followerStopped = true;
            terminal = progress;
        } else if (progress instanceof BordeauxRoutineProgress.Complete) {
            stopFollower();
            terminal = progress;
        }
        return progress;
    }

    private BordeauxRoutineProgress activeProgress() {
        return activeMotionGenerated
                ? runner.periodic()
                : new BordeauxRoutineProgress.Path(activeMotionId);
    }

    private void stopFollower() {
        if (followerStopped) return;
        followerStopped = true;
        follower.stop();
    }

    @Override
    public void close() {
        stopFollower();
        runner.close();
    }
}
