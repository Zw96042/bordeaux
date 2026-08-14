package dev.bordeaux.runtime;

import java.util.Objects;

/** Authoritative generated command and condition bindings for one compiled robot catalog. */
public record BordeauxCapabilities(BordeauxCommandRegistry commands, BordeauxConditionRegistry conditions) {
    public BordeauxCapabilities {
        commands = Objects.requireNonNull(commands, "commands");
        conditions = Objects.requireNonNull(conditions, "conditions");
        if (!commands.catalogId().equals(conditions.catalogId())
                || !commands.catalogHash().equals(conditions.catalogHash())) {
            throw new BordeauxRuntimeException("Bordeaux command and condition registries must share one catalog identity");
        }
    }

    public String catalogId() {
        return commands.catalogId();
    }

    public String catalogHash() {
        return commands.catalogHash();
    }
}
