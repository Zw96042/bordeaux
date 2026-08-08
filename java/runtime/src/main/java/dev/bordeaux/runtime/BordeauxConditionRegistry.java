package dev.bordeaux.runtime;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.BooleanSupplier;

/** Explicit stable-ID predicates used by conditional events and routine decisions. */
public final class BordeauxConditionRegistry {
    private final Map<String, BooleanSupplier> conditions;

    private BordeauxConditionRegistry(Map<String, BooleanSupplier> conditions) {
        this.conditions = Map.copyOf(conditions);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static BordeauxConditionRegistry empty() {
        return builder().build();
    }

    public boolean evaluate(String id) {
        if (id == null || id.isBlank()) return true;
        BooleanSupplier condition = conditions.get(id);
        if (condition == null) throw new BordeauxRuntimeException("Unknown Bordeaux condition ID '" + id + "'");
        try {
            return condition.getAsBoolean();
        } catch (RuntimeException exception) {
            throw new BordeauxRuntimeException("Condition '" + id + "' failed: " + exception.getMessage(), exception);
        }
    }

    public static final class Builder {
        private final Map<String, BooleanSupplier> conditions = new LinkedHashMap<>();

        public Builder register(String id, BooleanSupplier condition) {
            if (id == null || !id.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) {
                throw new BordeauxRuntimeException("Condition ID must be a stable 1-256 character identifier");
            }
            if (conditions.putIfAbsent(id, Objects.requireNonNull(condition, "condition")) != null) {
                throw new BordeauxRuntimeException("Duplicate Bordeaux condition ID '" + id + "'");
            }
            return this;
        }

        public BordeauxConditionRegistry build() {
            return new BordeauxConditionRegistry(conditions);
        }
    }
}
