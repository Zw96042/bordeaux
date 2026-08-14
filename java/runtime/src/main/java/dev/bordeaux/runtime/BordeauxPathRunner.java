package dev.bordeaux.runtime;

import java.util.Objects;

/** Keeps trajectory references and authored command events on one path clock. */
public final class BordeauxPathRunner implements AutoCloseable {
    private final BordeauxReferenceFollower follower;
    private final BordeauxEventRunner events;
    private double elapsedS;
    private boolean active;

    public BordeauxPathRunner(BordeauxPathEvents path, BordeauxCommandRegistry commands) {
        this(path, commands, BordeauxConditionRegistry.empty(), BordeauxEventRunner.Scheduler.wpilib());
    }

    public BordeauxPathRunner(BordeauxPathEvents path, BordeauxCommandRegistry commands,
            BordeauxEventRunner.Scheduler scheduler) {
        this(path, commands, BordeauxConditionRegistry.empty(), scheduler);
    }

    public BordeauxPathRunner(BordeauxPathEvents path, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions, BordeauxEventRunner.Scheduler scheduler) {
        Objects.requireNonNull(path, "path");
        follower = new BordeauxReferenceFollower(path);
        events = new BordeauxEventRunner(path, commands, conditions, scheduler);
        reset();
    }

    /**
     * Advances the path by one robot loop and returns the reference for the team's drivetrain
     * controller. measuredFraction must describe actual monotonic robot progress, not the returned
     * lookahead sample's fraction.
     */
    public BordeauxSample update(double dtS, double measuredXM, double measuredYM, double measuredFraction) {
        if (!active) throw new BordeauxRuntimeException("Path runner is stopped; call reset() before update()");
        if (!Double.isFinite(dtS) || dtS < 0 || !Double.isFinite(measuredXM)
                || !Double.isFinite(measuredYM) || !Double.isFinite(measuredFraction)
                || measuredFraction < 0 || measuredFraction > 1) {
            throw new BordeauxRuntimeException(
                    "Path update values must be finite; dtS cannot be negative and measured fraction must be in range");
        }
        BordeauxSample reference = follower.update(dtS, measuredXM, measuredYM);
        elapsedS += dtS;
        events.periodic(elapsedS, measuredFraction);
        return reference;
    }

    public boolean isFinished() {
        return follower.isFinished();
    }

    public double elapsedS() {
        return elapsedS;
    }

    public int firedEventCount() {
        return events.firedCount();
    }

    /** Cancels path-owned event commands and prepares this same path to run again. */
    public void reset() {
        follower.reset();
        events.reset();
        elapsedS = 0;
        active = true;
    }

    /** Ends this path. Team drivetrain code remains responsible for stopping its outputs. */
    public void end() {
        if (!active) return;
        events.endPath();
        active = false;
    }

    public void stop() {
        end();
    }

    @Override
    public void close() {
        end();
    }
}
