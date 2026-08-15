package dev.bordeaux.runtime;

import java.util.Objects;

/** Authoritative generated bindings for one compiled robot catalog. */
public record BordeauxCapabilities(
        BordeauxCommandRegistry commands,
        BordeauxConditionRegistry conditions,
        BordeauxTrajectoryGeneratorRegistry trajectoryGenerators) {
    /** Preserves source compatibility for support 0.1-0.3 callers. */
    public BordeauxCapabilities(BordeauxCommandRegistry commands, BordeauxConditionRegistry conditions) {
        this(commands, conditions, BordeauxTrajectoryGeneratorRegistry.empty(commands.catalogId(), commands.catalogHash()));
    }

    public BordeauxCapabilities {
        commands = Objects.requireNonNull(commands, "commands");
        conditions = Objects.requireNonNull(conditions, "conditions");
        trajectoryGenerators = Objects.requireNonNull(trajectoryGenerators, "trajectoryGenerators");
        if (!commands.catalogId().equals(conditions.catalogId())
                || !commands.catalogHash().equals(conditions.catalogHash())
                || !commands.catalogId().equals(trajectoryGenerators.catalogId())
                || !commands.catalogHash().equals(trajectoryGenerators.catalogHash())) {
            throw new BordeauxRuntimeException("Bordeaux registries must share one catalog identity");
        }
    }

    public String catalogId() {
        return commands.catalogId();
    }

    public String catalogHash() {
        return commands.catalogHash();
    }
}
