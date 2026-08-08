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
}
