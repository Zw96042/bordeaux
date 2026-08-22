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
