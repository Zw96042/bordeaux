package dev.bordeaux.runtime;

/** One immutable field-frame reference from an exported Bordeaux trajectory. */
public record BordeauxSample(
        int index,
        double timeS,
        double distanceM,
        double fraction,
        double xM,
        double yM,
        double headingRad,
        double velocityMps,
        double accelerationMps2,
        double angularVelocityRadps,
        double curvatureInvM,
        double travelHeadingRad) {
    /** Preserves the dynamics-complete API while deriving paths migrate to an explicit travel heading. */
    public BordeauxSample(int index, double timeS, double distanceM, double fraction,
            double xM, double yM, double headingRad, double velocityMps,
            double accelerationMps2, double angularVelocityRadps, double curvatureInvM) {
        this(index, timeS, distanceM, fraction, xM, yM, headingRad, velocityMps,
                accelerationMps2, angularVelocityRadps, curvatureInvM, headingRad);
    }

    /** Preserves the original Java API for generated trajectories that do not declare dynamics. */
    public BordeauxSample(int index, double timeS, double distanceM, double fraction,
            double xM, double yM, double headingRad, double velocityMps) {
        this(index, timeS, distanceM, fraction, xM, yM, headingRad, velocityMps, 0, 0, 0, headingRad);
    }

    /** Field-relative X velocity derived from signed path speed and travel direction. */
    public double fieldVelocityXMps() {
        return velocityMps * Math.cos(travelHeadingRad);
    }

    /** Field-relative Y velocity derived from signed path speed and travel direction. */
    public double fieldVelocityYMps() {
        return velocityMps * Math.sin(travelHeadingRad);
    }
}
