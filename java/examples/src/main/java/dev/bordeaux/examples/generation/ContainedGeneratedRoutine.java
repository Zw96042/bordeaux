package dev.bordeaux.examples.generation;

import dev.bordeaux.runtime.BordeauxCapabilities;
import dev.bordeaux.runtime.BordeauxGeneratedTrajectorySafety;
import dev.bordeaux.runtime.BordeauxGenerationContext;
import dev.bordeaux.runtime.BordeauxPathEvents;
import dev.bordeaux.runtime.BordeauxRoutineRunner;
import dev.bordeaux.runtime.BordeauxRuntimeCompatibility;
import java.util.Objects;
import java.util.function.Supplier;

/** Complete robot-side containment wiring for an Aquitaine routine with generated trajectories. */
public final class ContainedGeneratedRoutine {
    private static final String SUPPORT_VERSION = "0.4.0";

    private ContainedGeneratedRoutine() {}

    public static BordeauxRoutineRunner create(
            BordeauxPathEvents document,
            BordeauxCapabilities capabilities,
            String fieldId,
            String fieldRevision,
            String fieldCoordinateSchemaId,
            Supplier<BordeauxGenerationContext> currentState,
            BordeauxGeneratedTrajectorySafety.FieldValidator fieldValidator,
            BordeauxGeneratedTrajectorySafety.CollisionValidator collisionValidator,
            Runnable safeStop) {
        Objects.requireNonNull(capabilities, "capabilities");
        var compatibility = new BordeauxRuntimeCompatibility(
                capabilities.catalogId(),
                capabilities.catalogHash(),
                SUPPORT_VERSION,
                fieldId,
                fieldRevision,
                fieldCoordinateSchemaId);
        var safety = new BordeauxGeneratedTrajectorySafety(
                compatibility,
                currentState,
                fieldValidator,
                collisionValidator,
                safeStop);
        return new BordeauxRoutineRunner(document, capabilities, safety);
    }
}
