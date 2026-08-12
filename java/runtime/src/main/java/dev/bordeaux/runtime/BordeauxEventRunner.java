package dev.bordeaux.runtime;

import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/** Schedules due events exactly once from the robot's normal periodic loop. */
public final class BordeauxEventRunner implements AutoCloseable {
    private static final int MAX_INVOCATIONS_PER_UPDATE = 64;

    public interface Scheduler {
        void schedule(Command command);

        void cancel(Command command);

        /** Reports whether a command is still running. Non-WPILib custom schedulers must override this. */
        default boolean isScheduled(Command command) {
            return CommandScheduler.getInstance().isScheduled(command);
        }

        static Scheduler wpilib() {
            return new Scheduler() {
                @Override
                public void schedule(Command command) {
                    CommandScheduler.getInstance().schedule(command);
                }

                @Override
                public void cancel(Command command) {
                    CommandScheduler.getInstance().cancel(command);
                }
            };
        }
    }

    private final BordeauxPathEvents path;
    private final BordeauxCommandRegistry registry;
    private final BordeauxConditionRegistry conditions;
    private final Scheduler scheduler;
    private final List<Command> cancelOnEnd = new ArrayList<>();
    private final List<EventState> states = new ArrayList<>();
    private int firedCount;
    private double lastElapsedS = -1;
    private double maximumFraction;
    private boolean active = true;

    public BordeauxEventRunner(BordeauxPathEvents path, BordeauxCommandRegistry registry) {
        this(path, registry, BordeauxConditionRegistry.empty(), Scheduler.wpilib());
    }

    public BordeauxEventRunner(BordeauxPathEvents path, BordeauxCommandRegistry registry, Scheduler scheduler) {
        this(path, registry, BordeauxConditionRegistry.empty(), scheduler);
    }

    public BordeauxEventRunner(BordeauxPathEvents path, BordeauxCommandRegistry registry,
            BordeauxConditionRegistry conditions, Scheduler scheduler) {
        this.path = Objects.requireNonNull(path, "path");
        this.registry = Objects.requireNonNull(registry, "registry");
        this.conditions = Objects.requireNonNull(conditions, "conditions");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
        if (!path.catalogId().equals(registry.catalogId())) {
            throw new BordeauxRuntimeException("Trajectory catalog ID '" + path.catalogId()
                    + "' does not match robot registry '" + registry.catalogId() + "'");
        }
        if (!path.catalogHash().equals(registry.catalogHash())) {
            throw new BordeauxRuntimeException("Trajectory catalog hash " + path.catalogHash()
                    + " does not match robot registry " + registry.catalogHash());
        }
        validatePath();
        reset();
    }

    /** Call once per robot loop with elapsed path time. All newly due events are caught up in order. */
    public void periodic(double elapsedS) {
        periodic(elapsedS, maximumFraction);
    }

    /** Call once per robot loop with elapsed time and monotonic measured path progress. */
    public void periodic(double elapsedS, double measuredFraction) {
        if (!active) throw new BordeauxRuntimeException("Event runner is stopped; call reset() before periodic()");
        if (!Double.isFinite(elapsedS) || elapsedS < 0 || !Double.isFinite(measuredFraction)
                || measuredFraction < 0 || measuredFraction > 1) {
            throw new BordeauxRuntimeException("Elapsed time and measured fraction must be finite and in range");
        }
        if (elapsedS < lastElapsedS) {
            throw new BordeauxRuntimeException("Elapsed path time moved backwards; call reset() before restarting a path");
        }
        double updatedMaximumFraction = Math.max(maximumFraction, measuredFraction);
        CatchUpPlan plan = planCatchUp(elapsedS, updatedMaximumFraction);
        lastElapsedS = elapsedS;
        maximumFraction = updatedMaximumFraction;
        for (int index : plan.expiredIndexes()) states.get(index).complete = true;
        for (DueInvocation invocation : plan.invocations()) {
            BordeauxEvent event = path.events().get(invocation.eventIndex());
            EventState state = states.get(invocation.eventIndex());
            if (!state.activated) {
                state.activated = true;
                state.nextTimeS = invocation.timeS();
            }
            if (event.repeatEveryS() == null) {
                if (conditions.evaluate(event.conditionId())) { schedule(event); state.complete = true; }
                continue;
            }
            if (conditions.evaluate(event.conditionId())) schedule(event);
            state.nextTimeS = invocation.timeS() + event.repeatEveryS();
            if (event.endTimeS() != null && state.nextTimeS > event.endTimeS() + 1e-9) state.complete = true;
        }
    }

    /** Cancels commands explicitly owned until path end and makes the runner inactive. */
    public void endPath() {
        cancelOwnedCommands();
        active = false;
    }

    /** Stops the runner early with the same ownership semantics as a normal path end. */
    public void stop() {
        endPath();
    }

    /** Cancels owned commands and prepares the same path to run again from time zero. */
    public void reset() {
        cancelOwnedCommands();
        states.clear();
        path.events().forEach(event -> states.add(new EventState()));
        firedCount = 0;
        lastElapsedS = -1;
        maximumFraction = 0;
        active = true;
    }

    public int firedCount() {
        return firedCount;
    }

    private void validatePath() {
        validateEvents(path.events(), registry, conditions);
    }

    static void validateEvents(List<BordeauxEvent> events, BordeauxCommandRegistry registry,
            BordeauxConditionRegistry conditions) {
        for (BordeauxEvent event : events) {
            try {
                registry.validateInvocation(event.commandId(), event.arguments());
                conditions.validateReference(event.conditionId());
            } catch (RuntimeException exception) {
                throw new BordeauxRuntimeException(
                        "Event '" + event.eventId() + "' is invalid: " + exception.getMessage(), exception);
            }
        }
    }

    private CatchUpPlan planCatchUp(double elapsedS, double measuredFraction) {
        List<DueInvocation> invocations = new ArrayList<>();
        List<Integer> expiredIndexes = new ArrayList<>();
        for (int index = 0; index < path.events().size(); index++) {
            BordeauxEvent event = path.events().get(index);
            EventState state = states.get(index);
            if (state.complete) continue;
            boolean expired = event.endTimeS() != null && elapsedS > event.endTimeS() + 1e-9;
            if (expired && (!state.activated || event.repeatEveryS() == null)) {
                expiredIndexes.add(index);
                continue;
            }
            boolean due = event.trigger() == BordeauxEvent.Trigger.TIME
                    ? elapsedS >= event.timeS() : measuredFraction >= event.fraction();
            if (!state.activated && !due) continue;
            double nextTimeS = state.activated
                    ? state.nextTimeS
                    : (event.trigger() == BordeauxEvent.Trigger.TIME ? event.timeS() : elapsedS);
            if (event.repeatEveryS() == null) {
                addInvocation(invocations, index, nextTimeS);
                continue;
            }
            while (nextTimeS <= elapsedS + 1e-9
                    && (event.endTimeS() == null || nextTimeS <= event.endTimeS() + 1e-9)) {
                addInvocation(invocations, index, nextTimeS);
                nextTimeS += event.repeatEveryS();
            }
        }
        invocations.sort(Comparator.comparingDouble(DueInvocation::timeS)
                .thenComparingInt(DueInvocation::eventIndex));
        return new CatchUpPlan(invocations, expiredIndexes);
    }

    private static void addInvocation(List<DueInvocation> invocations, int eventIndex, double timeS) {
        if (invocations.size() >= MAX_INVOCATIONS_PER_UPDATE) {
            throw new BordeauxRuntimeException("Event catch-up exceeds the safe per-update limit of "
                    + MAX_INVOCATIONS_PER_UPDATE + " invocations");
        }
        invocations.add(new DueInvocation(eventIndex, timeS));
    }

    private void schedule(BordeauxEvent event) {
        try {
            Command command = registry.create(event.commandId(), event.arguments());
            scheduler.schedule(command);
            if (event.cancelOnPathEnd()) cancelOnEnd.add(command);
            firedCount++;
        } catch (RuntimeException exception) {
            throw new BordeauxRuntimeException("Event '" + event.eventId() + "' could not be scheduled: " + exception.getMessage(), exception);
        }
    }

    private void cancelOwnedCommands() {
        for (Command command : cancelOnEnd) scheduler.cancel(command);
        cancelOnEnd.clear();
    }

    @Override
    public void close() {
        stop();
    }

    private static final class EventState {
        private boolean activated;
        private boolean complete;
        private double nextTimeS;
    }

    private record DueInvocation(int eventIndex, double timeS) {}

    private record CatchUpPlan(List<DueInvocation> invocations, List<Integer> expiredIndexes) {}
}
