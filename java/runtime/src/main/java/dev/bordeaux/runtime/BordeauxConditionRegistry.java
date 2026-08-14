package dev.bordeaux.runtime;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.BooleanSupplier;

/** Explicit stable-ID predicates used by conditional events and routine decisions. */
public final class BordeauxConditionRegistry {
    private final Map<String, BooleanSupplier> conditions;
    private final String catalogId;
    private final String catalogHash;

    private BordeauxConditionRegistry(Map<String, BooleanSupplier> conditions, String catalogId, String catalogHash) {
        this.conditions = Map.copyOf(conditions);
        this.catalogId = catalogId;
        this.catalogHash = catalogHash;
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

    /** Returns whether this registry has a concrete binding for the supplied condition ID. */
    public boolean contains(String id) {
        return id != null && !id.isBlank() && conditions.containsKey(id);
    }

    /** Fails before execution when an authored decision or optional marker condition is unavailable. */
    public void preflight(Iterable<String> ids) {
        Objects.requireNonNull(ids, "ids");
        for (String id : ids) {
            if (id != null && !id.isBlank() && !contains(id)) {
                throw new BordeauxRuntimeException("Unknown Bordeaux condition ID '" + id + "'");
            }
        }
    }

    public String catalogId() {
        if (catalogId == null) throw new BordeauxRuntimeException("Manual Bordeaux condition registries do not have a catalog identity");
        return catalogId;
    }

    public String catalogHash() {
        if (catalogHash == null) throw new BordeauxRuntimeException("Manual Bordeaux condition registries do not have a catalog identity");
        return catalogHash;
    }

    public static final class Builder {
        private final Map<String, BooleanSupplier> conditions = new LinkedHashMap<>();
        private String catalogId;
        private String catalogHash;

        public Builder catalogId(String catalogId) {
            if (catalogId == null || catalogId.isBlank() || catalogId.length() > 256) {
                throw new IllegalArgumentException("Catalog ID must be a nonempty string of at most 256 characters");
            }
            this.catalogId = catalogId;
            return this;
        }

        public Builder catalogHash(String catalogHash) {
            if (catalogHash == null || !catalogHash.matches("sha256:[0-9a-f]{64}")) {
                throw new IllegalArgumentException("Catalog hash must use sha256:<64 lowercase hex characters>");
            }
            this.catalogHash = catalogHash;
            return this;
        }

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
            if ((catalogId == null) != (catalogHash == null)) {
                throw new IllegalStateException("Condition catalog ID and hash must be supplied together");
            }
            return new BordeauxConditionRegistry(conditions, catalogId, catalogHash);
        }
    }
}
