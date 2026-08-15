package dev.bordeaux.runtime;

/** Immutable limits attached to a generated-trajectory descriptor or active robot runtime. */
public record BordeauxTrajectoryGeneratorLimits(
        int timeoutMs,
        int maxSamples,
        double maxDurationS,
        double maxDistanceM,
        double maxVelocityMps,
        double maxAccelerationMps2,
        double maxCentripetalAccelerationMps2,
        double maxAngularVelocityRadps,
        double maxAngularAccelerationRadps2,
        double minClearanceM) {
    public BordeauxTrajectoryGeneratorLimits {
        requireRange(timeoutMs, 1, 100, "timeoutMs");
        requireRange(maxSamples, 2, 4096, "maxSamples");
        requireRange(maxDurationS, 0.02, 15, "maxDurationS");
        requireRange(maxDistanceM, 0, 54, "maxDistanceM");
        requireRange(maxVelocityMps, 0, 10, "maxVelocityMps");
        requireRange(maxAccelerationMps2, 0, 30, "maxAccelerationMps2");
        requireRange(maxCentripetalAccelerationMps2, 0, 30, "maxCentripetalAccelerationMps2");
        requireRange(maxAngularVelocityRadps, 0, 25, "maxAngularVelocityRadps");
        requireRange(maxAngularAccelerationRadps2, 0, 100, "maxAngularAccelerationRadps2");
        requireRange(minClearanceM, 0, 2, "minClearanceM");
    }

    private static void requireRange(int value, int minimum, int maximum, String name) {
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException(name + " must be between " + minimum + " and " + maximum);
        }
    }

    private static void requireRange(double value, double minimum, double maximum, String name) {
        if (!Double.isFinite(value) || value < minimum || value > maximum) {
            throw new IllegalArgumentException(name + " must be finite and between " + minimum + " and " + maximum);
        }
    }
}
