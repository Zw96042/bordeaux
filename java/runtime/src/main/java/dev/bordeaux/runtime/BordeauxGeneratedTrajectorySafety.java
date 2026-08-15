package dev.bordeaux.runtime;

import java.util.Objects;
import java.util.function.Supplier;

/** Robot-owned state and geometry checks required before a generated trajectory may run. */
public record BordeauxGeneratedTrajectorySafety(
        BordeauxRuntimeCompatibility compatibility,
        Supplier<BordeauxGenerationContext> generationContext,
        FieldValidator fieldValidator,
        CollisionValidator collisionValidator,
        Runnable safeStop) {
    @FunctionalInterface
    public interface FieldValidator {
        /** Called on the generator worker for every sample; implementations must be thread-safe and side-effect free. */
        boolean contains(BordeauxSample sample, double clearanceM);
    }

    @FunctionalInterface
    public interface CollisionValidator {
        /** Called on the generator worker for every swept segment; implementations must be thread-safe and side-effect free. */
        boolean isCollisionFree(BordeauxSample from, BordeauxSample to, double clearanceM);
    }

    public BordeauxGeneratedTrajectorySafety {
        compatibility = Objects.requireNonNull(compatibility, "compatibility");
        generationContext = Objects.requireNonNull(generationContext, "generationContext");
        fieldValidator = Objects.requireNonNull(fieldValidator, "fieldValidator");
        collisionValidator = Objects.requireNonNull(collisionValidator, "collisionValidator");
        safeStop = Objects.requireNonNull(safeStop, "safeStop");
        if (!"0.4.0".equals(compatibility.supportVersion())) {
            throw new IllegalArgumentException("Generated trajectory safety requires Bordeaux support 0.4.0");
        }
    }
}
