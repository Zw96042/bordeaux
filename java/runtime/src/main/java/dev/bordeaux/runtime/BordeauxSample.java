package dev.bordeaux.runtime;

/** One immutable robot-frame reference from an exported Bordeaux trajectory. */
public record BordeauxSample(
        int index,
        double timeS,
        double distanceM,
        double fraction,
        double xM,
        double yM,
        double headingRad,
        double velocityMps) {}
