package dev.bordeaux.runtime;

import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** Schedules due events exactly once from the robot's normal periodic loop. */
public final class BordeauxEventRunner implements AutoCloseable {
    public interface Scheduler {
        void schedule(Command command);

        void cancel(Command command);

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
    private final Scheduler scheduler;
    private final List<Command> cancelOnEnd = new ArrayList<>();
    private int nextEvent;
    private double lastElapsedS = -1;
    private boolean active = true;

    public BordeauxEventRunner(BordeauxPathEvents path, BordeauxCommandRegistry registry) {
        this(path, registry, Scheduler.wpilib());
    }

    public BordeauxEventRunner(BordeauxPathEvents path, BordeauxCommandRegistry registry, Scheduler scheduler) {
        this.path = Objects.requireNonNull(path, "path");
        this.registry = Objects.requireNonNull(registry, "registry");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
        if (!path.catalogId().equals(registry.catalogId())) {
            throw new BordeauxRuntimeException("Trajectory catalog ID '" + path.catalogId()
                    + "' does not match robot registry '" + registry.catalogId() + "'");
        }
        if (!path.catalogHash().equals(registry.catalogHash())) {
            throw new BordeauxRuntimeException("Trajectory catalog hash " + path.catalogHash()
                    + " does not match robot registry " + registry.catalogHash());
        }
    }

    /** Call once per robot loop with elapsed path time. All newly due events are caught up in order. */
    public void periodic(double elapsedS) {
        if (!active) throw new BordeauxRuntimeException("Event runner is stopped; call reset() before periodic()");
        if (!Double.isFinite(elapsedS) || elapsedS < 0) {
            throw new BordeauxRuntimeException("Elapsed path time must be finite and nonnegative");
        }
        if (elapsedS < lastElapsedS) {
            throw new BordeauxRuntimeException("Elapsed path time moved backwards; call reset() before restarting a path");
        }
        lastElapsedS = elapsedS;
        List<BordeauxEvent> events = path.events();
        while (nextEvent < events.size() && events.get(nextEvent).timeS() <= elapsedS) {
            BordeauxEvent event = events.get(nextEvent);
            try {
                Command command = registry.create(event.commandId(), event.arguments());
                scheduler.schedule(command);
                if (event.cancelOnPathEnd()) cancelOnEnd.add(command);
                nextEvent++;
            } catch (BordeauxRuntimeException exception) {
                throw new BordeauxRuntimeException("Event '" + event.eventId() + "' failed: " + exception.getMessage(), exception);
            } catch (RuntimeException exception) {
                throw new BordeauxRuntimeException("Event '" + event.eventId() + "' could not be scheduled: " + exception.getMessage(), exception);
            }
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
        nextEvent = 0;
        lastElapsedS = -1;
        active = true;
    }

    public int firedCount() {
        return nextEvent;
    }

    private void cancelOwnedCommands() {
        for (Command command : cancelOnEnd) scheduler.cancel(command);
        cancelOnEnd.clear();
    }

    @Override
    public void close() {
        stop();
    }
}
