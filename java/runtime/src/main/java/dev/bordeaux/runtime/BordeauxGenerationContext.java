package dev.bordeaux.runtime;

import java.util.Objects;

/** Bounded robot state injected into a generated-trajectory invocation. */
public record BordeauxGenerationContext(
        double xM,
        double yM,
        double headingRad,
        String fieldId,
        String fieldRevision,
        String fieldCoordinateSchemaId,
        BordeauxTrajectoryGeneratorLimits safetyLimits) {
    public BordeauxGenerationContext {
        if (!Double.isFinite(xM) || !Double.isFinite(yM) || !Double.isFinite(headingRad)) {
            throw new IllegalArgumentException("Generation pose must be finite");
        }
        fieldId = required(fieldId, "fieldId");
        fieldRevision = required(fieldRevision, "fieldRevision");
        fieldCoordinateSchemaId = required(fieldCoordinateSchemaId, "fieldCoordinateSchemaId");
        safetyLimits = Objects.requireNonNull(safetyLimits, "safetyLimits");
    }

    private static String required(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank() || value.length() > 256) throw new IllegalArgumentException(name + " is invalid");
        return value;
    }
}
