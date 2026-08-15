package dev.bordeaux.runtime;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Strict deployable steps evaluated between trajectories. */
public sealed interface BordeauxRoutineNode {
    String id();

    record Path(String id, String pathId) implements BordeauxRoutineNode {}

    record Decision(
            String id,
            String conditionId,
            List<BordeauxRoutineNode> whenTrue,
            List<BordeauxRoutineNode> whenFalse) implements BordeauxRoutineNode {
        public Decision {
            whenTrue = List.copyOf(whenTrue);
            whenFalse = List.copyOf(whenFalse);
        }
    }

    record Command(String id, String commandId, ObjectNode arguments) implements BordeauxRoutineNode {
        public Command {
            arguments = arguments.deepCopy();
        }
    }

    /** The closed Bordeaux-owned wait built-in, evaluated from the caller's periodic loop. */
    record Wait(String id, double durationS) implements BordeauxRoutineNode {
        public Wait {
            if (!Double.isFinite(durationS) || durationS < 0.02 || durationS > 15) {
                throw new IllegalArgumentException("Wait duration must be finite and between 0.02 and 15 seconds");
            }
        }
    }

    /** A post-beta runtime-dynamic segment; execution and validation are owned by runtime containment. */
    record GeneratedTrajectory(
            String id, String generatorId, ObjectNode arguments, GeneratedFallback fallback)
            implements BordeauxRoutineNode {
        public GeneratedTrajectory {
            arguments = arguments.deepCopy();
            fallback = java.util.Objects.requireNonNull(fallback, "fallback");
        }
    }

    sealed interface GeneratedFallback {
        record SafeStop() implements GeneratedFallback {}

        record Branch(List<BordeauxRoutineNode> nodes) implements GeneratedFallback {
            public Branch {
                nodes = List.copyOf(nodes);
            }
        }
    }
}
