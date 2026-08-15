package dev.bordeaux.runtime;

import java.util.List;

/** The routine's caller-driven state after a transition or periodic evaluation. */
public sealed interface BordeauxRoutineProgress {
    record Path(String pathId) implements BordeauxRoutineProgress {}

    record Waiting(double remainingS) implements BordeauxRoutineProgress {
        public Waiting {
            if (!Double.isFinite(remainingS) || remainingS <= 0) {
                throw new IllegalArgumentException("Remaining wait time must be finite and positive");
            }
        }
    }

    record Generating(String nodeId, String generatorId) implements BordeauxRoutineProgress {}

    /** Fully validated samples which the caller may now pass to its drivetrain follower. */
    record GeneratedTrajectory(String nodeId, String generatorId, List<BordeauxSample> samples)
            implements BordeauxRoutineProgress {
        public GeneratedTrajectory {
            samples = List.copyOf(samples);
        }
    }

    /** Terminal state confirming the robot-owned safe-stop callback ran for this generated step. */
    record SafeStopped(String nodeId, String generatorId) implements BordeauxRoutineProgress {}

    record Complete() implements BordeauxRoutineProgress {}
}
