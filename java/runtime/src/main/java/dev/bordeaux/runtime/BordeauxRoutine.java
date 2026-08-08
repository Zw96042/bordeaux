package dev.bordeaux.runtime;

import java.util.List;

/** Named deployable routine tree stored with every exported trajectory document. */
public record BordeauxRoutine(String name, List<BordeauxRoutineNode> nodes) {
    public BordeauxRoutine {
        nodes = List.copyOf(nodes);
    }

    public static BordeauxRoutine empty() {
        return new BordeauxRoutine("Autonomous Routine", List.of());
    }
}
