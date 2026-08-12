package dev.bordeaux.runtime;

import edu.wpi.first.wpilibj2.command.Command;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;
/** Resolves sensor decisions and commands only between completed path steps. */
public final class BordeauxRoutineRunner implements AutoCloseable {
    public enum Status { READY, PATH_ACTIVE, WAITING_FOR_COMMAND, COMPLETE, STOPPED }

    /** An atomic routine transition; only {@link Status#PATH_ACTIVE} carries a path ID. */
    public record Transition(Status status, Optional<String> pathId) {
        public Transition {
            Objects.requireNonNull(status, "status");
            Objects.requireNonNull(pathId, "pathId");
            if ((status == Status.PATH_ACTIVE) != pathId.isPresent()) {
                throw new IllegalArgumentException("Only an active-path transition may carry a path ID");
            }
        }
    }

    private final BordeauxRoutine routine;
    private final BordeauxCommandRegistry commands;
    private final BordeauxConditionRegistry conditions;
    private final BordeauxEventRunner.Scheduler scheduler;
    private final Deque<BordeauxRoutineNode> pending = new ArrayDeque<>();
    private String currentPathId;
    private Command activeCommand;
    private int commandCount;
    private Status status;
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
        validateNodes(routine.nodes());
        reset();
    }
    /** Legacy path-only view of {@link #startTransition()}; empty means the routine completed. */
    public Optional<String> start() {
        return legacyPath(() -> startTransition(false));
    }

    /** Resolves entry decisions and returns the first path, command wait, or completion transition. */
    public Transition startTransition() {
        return startTransition(true);
    }

    private Transition startTransition(boolean allowCommands) {
        if (status != Status.READY) throw new BordeauxRuntimeException("Routine is not ready; call reset() before start()");
        return advance(allowCommands);
    }

    /** Legacy path-only view of {@link #completePathTransition(String)}; empty means the routine completed. */
    public Optional<String> completePath(String completedPathId) {
        return legacyPath(() -> completePathTransition(completedPathId, false));
    }

    /** Marks the active path complete and returns the next routine transition. */
    public Transition completePathTransition(String completedPathId) {
        return completePathTransition(completedPathId, true);
    }

    private Transition completePathTransition(String completedPathId, boolean allowCommands) {
        if (status != Status.PATH_ACTIVE) throw new BordeauxRuntimeException("Routine has no active path to complete");
        if (!currentPathId.equals(completedPathId)) {
            throw new BordeauxRuntimeException("Completed path '" + completedPathId + "' does not match active path '" + currentPathId + "'");
        }
        currentPathId = null;
        status = Status.READY;
        return advance(allowCommands);
    }

    /** Polls a between-path command once; call once per robot loop while waiting. */
    public Transition periodic() {
        if (status != Status.WAITING_FOR_COMMAND) {
            throw new BordeauxRuntimeException("Routine has no active command to poll");
        }
        if (scheduler.isScheduled(activeCommand)) return transition();
        activeCommand = null;
        status = Status.READY;
        return advance(true);
    }

    public void reset() {
        cancelActiveCommand();
        pending.clear();
        prepend(routine.nodes());
        currentPathId = null;
        commandCount = 0;
        status = Status.READY;
    }

    public void stop() {
        cancelActiveCommand();
        pending.clear();
        currentPathId = null;
        status = Status.STOPPED;
    }

    public Status status() {
        return status;
    }

    public int commandCount() {
        return commandCount;
    }

    private void validateNodes(List<BordeauxRoutineNode> nodes) {
        Deque<BordeauxRoutineNode> remaining = new ArrayDeque<>();
        prepend(remaining, nodes);
        while (!remaining.isEmpty()) {
            BordeauxRoutineNode node = remaining.removeFirst();
            try {
                if (node instanceof BordeauxRoutineNode.Decision decision) {
                    conditions.validateReference(decision.conditionId());
                    prepend(remaining, decision.whenFalse());
                    prepend(remaining, decision.whenTrue());
                } else if (node instanceof BordeauxRoutineNode.Command invocation) {
                    commands.validateInvocation(invocation.commandId(), invocation.arguments());
                }
            } catch (RuntimeException exception) {
                throw new BordeauxRuntimeException(
                        "Routine node '" + node.id() + "' is invalid: " + exception.getMessage(), exception);
            }
        }
    }

    private Transition advance(boolean allowCommands) {
        int evaluated = 0;
        while (!pending.isEmpty()) {
            if (++evaluated > 10_000) throw new BordeauxRuntimeException("Routine transition exceeds 10000 steps");
            BordeauxRoutineNode node = pending.removeFirst();
            if (node instanceof BordeauxRoutineNode.Path path) {
                currentPathId = path.pathId();
                status = Status.PATH_ACTIVE;
                return transition();
            }
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                prepend(conditions.evaluate(decision.conditionId()) ? decision.whenTrue() : decision.whenFalse());
            } else if (node instanceof BordeauxRoutineNode.Command invocation) {
                if (!allowCommands) {
                    throw new BordeauxRuntimeException(
                            "Routine is waiting for a command; migrate to startTransition(), "
                                    + "completePathTransition(...), and periodic()");
                }
                Command command = commands.create(invocation.commandId(), invocation.arguments());
                scheduler.schedule(command);
                activeCommand = command;
                commandCount++;
                status = Status.WAITING_FOR_COMMAND;
                return transition();
            }
        }
        status = Status.COMPLETE;
        return transition();
    }

    private Transition transition() {
        return new Transition(status, Optional.ofNullable(currentPathId));
    }

    private Optional<String> legacyPath(Supplier<Transition> operation) {
        Deque<BordeauxRoutineNode> savedPending = new ArrayDeque<>(pending);
        String savedPathId = currentPathId;
        Status savedStatus = status;
        try {
            return operation.get().pathId();
        } catch (BordeauxRuntimeException exception) {
            pending.clear();
            pending.addAll(savedPending);
            currentPathId = savedPathId;
            status = savedStatus;
            throw exception;
        }
    }

    private void cancelActiveCommand() {
        if (activeCommand == null) return;
        scheduler.cancel(activeCommand);
        activeCommand = null;
    }

    private void prepend(List<BordeauxRoutineNode> nodes) {
        prepend(pending, nodes);
    }

    private static void prepend(Deque<BordeauxRoutineNode> target, List<BordeauxRoutineNode> nodes) {
        for (int index = nodes.size() - 1; index >= 0; index--) target.addFirst(nodes.get(index));
    }

    @Override
    public void close() {
        stop();
    }
}
