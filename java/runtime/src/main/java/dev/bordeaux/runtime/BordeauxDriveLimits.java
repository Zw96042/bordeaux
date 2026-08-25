package dev.bordeaux.runtime;

/** Robot-owned drivetrain limits; the adapter enforces velocity and exposes acceleration to callers. */
public record BordeauxDriveLimits(
        double maxLinearVelocityMps,
        double maxLinearAccelerationMps2,
        double maxAngularVelocityRadps,
        double maxAngularAccelerationRadps2) {
    public BordeauxDriveLimits {
        BordeauxRobotValues.requirePositiveFinite(maxLinearVelocityMps, "maxLinearVelocityMps");
        BordeauxRobotValues.requirePositiveFinite(maxLinearAccelerationMps2, "maxLinearAccelerationMps2");
        BordeauxRobotValues.requirePositiveFinite(maxAngularVelocityRadps, "maxAngularVelocityRadps");
        BordeauxRobotValues.requirePositiveFinite(maxAngularAccelerationRadps2, "maxAngularAccelerationRadps2");
    }
}
