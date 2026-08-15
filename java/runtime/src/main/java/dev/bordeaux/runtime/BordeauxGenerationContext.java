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
        BordeauxTrajectoryGeneratorLimits safetyLimits,
        double velocityXMps,
        double velocityYMps,
        double angularVelocityRadps) {
    /** Preserves the 0.4 source surface for robots that begin generation from rest. */
    public BordeauxGenerationContext(double xM, double yM, double headingRad,
            String fieldId, String fieldRevision, String fieldCoordinateSchemaId,
            BordeauxTrajectoryGeneratorLimits safetyLimits) {
        this(xM, yM, headingRad, fieldId, fieldRevision, fieldCoordinateSchemaId,
                safetyLimits, 0, 0, 0);
    }

    public BordeauxGenerationContext {
        if (!Double.isFinite(xM) || !Double.isFinite(yM) || !Double.isFinite(headingRad)) {
            throw new IllegalArgumentException("Generation pose must be finite");
        }
        fieldId = required(fieldId, "fieldId");
        fieldRevision = required(fieldRevision, "fieldRevision");
        fieldCoordinateSchemaId = required(fieldCoordinateSchemaId, "fieldCoordinateSchemaId");
        safetyLimits = Objects.requireNonNull(safetyLimits, "safetyLimits");
        if (!Double.isFinite(velocityXMps) || !Double.isFinite(velocityYMps)
                || !Double.isFinite(angularVelocityRadps)
                || Math.hypot(velocityXMps, velocityYMps) > safetyLimits.maxVelocityMps()
                || Math.abs(angularVelocityRadps) > safetyLimits.maxAngularVelocityRadps()) {
            throw new IllegalArgumentException("Generation velocity must be finite and within robot safety limits");
        }
    }

    private static String required(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank() || value.length() > 256) throw new IllegalArgumentException(name + " is invalid");
        return value;
    }
}
