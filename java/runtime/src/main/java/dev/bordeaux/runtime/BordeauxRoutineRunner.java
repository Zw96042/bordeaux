package dev.bordeaux.runtime;

import edu.wpi.first.wpilibj2.command.Command;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.DoubleSupplier;
/** Resolves sensor decisions and commands only between completed path steps. */
public final class BordeauxRoutineRunner implements AutoCloseable {
    private final BordeauxRoutine routine;
    private final BordeauxCommandRegistry commands;
    private final BordeauxConditionRegistry conditions;
    private final BordeauxEventRunner.Scheduler scheduler;
    private final DoubleSupplier clock;
    private final Deque<BordeauxRoutineNode> pending = new ArrayDeque<>();
    private String currentPathId;
    private Double waitDeadlineS;
    private double lastClockS = Double.NEGATIVE_INFINITY;
    private int commandCount;
    private boolean active;
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions) {
        this(document, commands, conditions, BordeauxEventRunner.Scheduler.wpilib(), BordeauxRoutineRunner::monotonicTimeS);
    }

    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions, BordeauxEventRunner.Scheduler scheduler) {
        this(document, commands, conditions, scheduler, BordeauxRoutineRunner::monotonicTimeS);
    }

    /** Uses an injected monotonic clock for deterministic caller-driven built-in waits. */
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCommandRegistry commands,
            BordeauxConditionRegistry conditions, BordeauxEventRunner.Scheduler scheduler, DoubleSupplier clock) {
        Objects.requireNonNull(document, "document");
        this.routine = document.routine();
        this.commands = Objects.requireNonNull(commands, "commands");
        this.conditions = Objects.requireNonNull(conditions, "conditions");
        this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
        this.clock = Objects.requireNonNull(clock, "clock");
        if (!document.catalogId().equals(commands.catalogId()) || !document.catalogHash().equals(commands.catalogHash())) {
            throw new BordeauxRuntimeException("Routine catalog does not match the robot command registry");
        }
        reset();
    }

    /** Uses one generated capability set and rejects every missing decision condition before the routine starts. */
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCapabilities capabilities) {
        this(document, capabilities, BordeauxEventRunner.Scheduler.wpilib(), BordeauxRoutineRunner::monotonicTimeS);
    }

    /** Uses one generated capability set and an explicit scheduler for integration testing. */
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCapabilities capabilities,
            BordeauxEventRunner.Scheduler scheduler) {
        this(document, capabilities, scheduler, BordeauxRoutineRunner::monotonicTimeS);
    }

    /** Uses generated capabilities, an explicit scheduler, and a monotonic clock for built-in waits. */
    public BordeauxRoutineRunner(BordeauxPathEvents document, BordeauxCapabilities capabilities,
            BordeauxEventRunner.Scheduler scheduler, DoubleSupplier clock) {
        this(document, Objects.requireNonNull(capabilities, "capabilities").commands(), capabilities.conditions(), scheduler, clock);
        if (!document.catalogId().equals(capabilities.catalogId()) || !document.catalogHash().equals(capabilities.catalogHash())) {
            throw new BordeauxRuntimeException("Routine catalog does not match generated Bordeaux capabilities");
        }
        capabilities.conditions().preflight(decisionConditionIds(document.routine().nodes()));
    }
    /** Resolves entry decisions and commands, returning the first path to run. */
    public Optional<String> start() {
        return legacy(startProgress());
    }

    /** Resolves entry nodes and reports a path, a pending built-in wait, or completion. */
    public BordeauxRoutineProgress startProgress() {
        if (!active) throw new BordeauxRuntimeException("Routine runner is stopped; call reset() before start()");
        if (currentPathId != null) throw new BordeauxRuntimeException("Routine already has an active path");
        if (waitDeadlineS != null) throw new BordeauxRuntimeException("Routine has an active wait; call periodic() to advance it");
        return advance();
    }
    /** Marks the active path complete and returns the next selected path, if any. */
    public Optional<String> completePath(String completedPathId) {
        return legacy(completePathProgress(completedPathId));
    }

    /** Marks an active path complete and reports the next caller-driven routine state. */
    public BordeauxRoutineProgress completePathProgress(String completedPathId) {
        if (!active || currentPathId == null) throw new BordeauxRuntimeException("Routine has no active path to complete");
        if (!currentPathId.equals(completedPathId)) {
            throw new BordeauxRuntimeException("Completed path '" + completedPathId + "' does not match active path '" + currentPathId + "'");
        }
        currentPathId = null;
        return advance();
    }

    /** Advances a pending built-in wait from the normal robot periodic loop. */
    public BordeauxRoutineProgress periodic() {
        if (!active) return new BordeauxRoutineProgress.Complete();
        if (currentPathId != null) return new BordeauxRoutineProgress.Path(currentPathId);
        if (waitDeadlineS == null) return advance();
        double remainingS = waitDeadlineS - now();
        if (remainingS > 0) return new BordeauxRoutineProgress.Waiting(remainingS);
        waitDeadlineS = null;
        return advance();
    }
    public void reset() {
        pending.clear();
        prepend(routine.nodes());
        currentPathId = null;
        waitDeadlineS = null;
        commandCount = 0;
        active = true;
    }

    public void stop() {
        pending.clear();
        currentPathId = null;
        waitDeadlineS = null;
        active = false;
    }

    public int commandCount() {
        return commandCount;
    }

    private BordeauxRoutineProgress advance() {
        int evaluated = 0;
        while (!pending.isEmpty()) {
            if (++evaluated > 10_000) throw new BordeauxRuntimeException("Routine transition exceeds 10000 steps");
            BordeauxRoutineNode node = pending.removeFirst();
            if (node instanceof BordeauxRoutineNode.Path path) {
                currentPathId = path.pathId();
                return new BordeauxRoutineProgress.Path(currentPathId);
            }
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                prepend(conditions.evaluate(decision.conditionId()) ? decision.whenTrue() : decision.whenFalse());
            } else if (node instanceof BordeauxRoutineNode.Command invocation) {
                Command command = commands.create(invocation.commandId(), invocation.arguments());
                scheduler.schedule(command);
                commandCount++;
            } else if (node instanceof BordeauxRoutineNode.Wait wait) {
                double startedAtS = now();
                double deadlineS = startedAtS + wait.durationS();
                if (!Double.isFinite(deadlineS) || deadlineS <= startedAtS) {
                    throw new BordeauxRuntimeException("Routine clock is too large to schedule a finite wait deadline");
                }
                waitDeadlineS = deadlineS;
                return new BordeauxRoutineProgress.Waiting(wait.durationS());
            }
        }
        active = false;
        return new BordeauxRoutineProgress.Complete();
    }

    private Optional<String> legacy(BordeauxRoutineProgress progress) {
        if (progress instanceof BordeauxRoutineProgress.Path path) return Optional.of(path.pathId());
        if (progress instanceof BordeauxRoutineProgress.Complete) return Optional.empty();
        throw new BordeauxRuntimeException("Routine contains a Bordeaux wait built-in; use the caller-driven progress API");
    }

    private double now() {
        double time = clock.getAsDouble();
        if (!Double.isFinite(time)) throw new BordeauxRuntimeException("Routine clock must return a finite monotonic time");
        if (time < lastClockS) throw new BordeauxRuntimeException("Routine clock must be monotonic");
        lastClockS = time;
        return time;
    }

    private static double monotonicTimeS() {
        return System.nanoTime() / 1_000_000_000.0;
    }

    private void prepend(List<BordeauxRoutineNode> nodes) {
        for (int index = nodes.size() - 1; index >= 0; index--) pending.addFirst(nodes.get(index));
    }

    private static List<String> decisionConditionIds(List<BordeauxRoutineNode> nodes) {
        List<String> ids = new java.util.ArrayList<>();
        collectDecisionConditionIds(nodes, ids);
        return ids;
    }

    private static void collectDecisionConditionIds(List<BordeauxRoutineNode> nodes, List<String> ids) {
        for (BordeauxRoutineNode node : nodes) {
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                ids.add(decision.conditionId());
                collectDecisionConditionIds(decision.whenTrue(), ids);
                collectDecisionConditionIds(decision.whenFalse(), ids);
            }
        }
    }

    @Override
    public void close() {
        stop();
    }
}
