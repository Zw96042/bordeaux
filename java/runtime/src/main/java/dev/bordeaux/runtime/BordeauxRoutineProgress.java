package dev.bordeaux.runtime;

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

    record Complete() implements BordeauxRoutineProgress {}
}
