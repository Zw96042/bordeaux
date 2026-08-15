package dev.bordeaux.annotations;

/** Closed failure policy declared by a robot-owned trajectory generator. */
public enum BordeauxTrajectoryFallbackPolicy {
    UNSPECIFIED,
    SAFE_STOP_ONLY,
    VALIDATED_BRANCH
}
