package dev.bordeaux.runtime;

import edu.wpi.first.wpilibj2.command.Command;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
/** Resolves sensor decisions and commands only between completed path steps. */
public final class BordeauxRoutineRunner implements AutoCloseable {
    private final BordeauxRoutine routine;
    private final BordeauxCommandRegistry commands;
    private final BordeauxConditionRegistry conditions;
    private final BordeauxEventRunner.Scheduler scheduler;
    private final Deque<BordeauxRoutineNode> pending = new ArrayDeque<>();
    private String currentPathId;
    private int commandCount;
    private boolean active;
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions) {
        this(document, commands, conditions, BordeauxEventRunner.Scheduler.wpilib());
    }

    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions, BordeauxEventRunner.Scheduler scheduler) {
        Objects.requireNonNull(document, "document");
        this.routine = document.routine();
        this.commands = Objects.requireNonNull(commands, "commands");
        this.conditions = Objects.requireNonNull(conditions, "conditions");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
        if (!document.catalogId().equals(commands.catalogId()) || !document.catalogHash().equals(commands.catalogHash())) {
            throw new BordeauxRuntimeException("Routine catalog does not match the robot command registry");
        }
        reset();
    }
    /** Resolves entry decisions and commands, returning the first path to run. */
    public Optional<String> start() {
        if (!active) throw new BordeauxRuntimeException("Routine runner is stopped; call reset() before start()");
        if (currentPathId != null) throw new BordeauxRuntimeException("Routine already has an active path");
        return advance();
    }
    /** Marks the active path complete and returns the next selected path, if any. */
    public Optional<String> completePath(String completedPathId) {
        if (!active || currentPathId == null) throw new BordeauxRuntimeException("Routine has no active path to complete");
        if (!currentPathId.equals(completedPathId)) {
            throw new BordeauxRuntimeException("Completed path '" + completedPathId + "' does not match active path '" + currentPathId + "'");
        }
        currentPathId = null;
        return advance();
    }
    public void reset() {
        pending.clear();
        prepend(routine.nodes());
        currentPathId = null;
        commandCount = 0;
        active = true;
    }

    public void stop() {
        pending.clear();
        currentPathId = null;
        active = false;
    }

    public int commandCount() {
        return commandCount;
    }

    private Optional<String> advance() {
        int evaluated = 0;
        while (!pending.isEmpty()) {
            if (++evaluated > 10_000) throw new BordeauxRuntimeException("Routine transition exceeds 10000 steps");
            BordeauxRoutineNode node = pending.removeFirst();
            if (node instanceof BordeauxRoutineNode.Path path) {
                currentPathId = path.pathId();
                return Optional.of(currentPathId);
            }
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                prepend(conditions.evaluate(decision.conditionId()) ? decision.whenTrue() : decision.whenFalse());
            } else if (node instanceof BordeauxRoutineNode.Command invocation) {
                Command command = commands.create(invocation.commandId(), invocation.arguments());
                scheduler.schedule(command);
                commandCount++;
            }
        }
        active = false;
        return Optional.empty();
    }

    private void prepend(List<BordeauxRoutineNode> nodes) {
        for (int index = nodes.size() - 1; index >= 0; index--) pending.addFirst(nodes.get(index));
    }

    @Override
    public void close() {
        stop();
    }
}
