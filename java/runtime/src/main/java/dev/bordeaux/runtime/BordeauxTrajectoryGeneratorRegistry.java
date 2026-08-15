package dev.bordeaux.runtime;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Descriptor-bearing direct-call registry; only Bordeaux runtime containment may invoke entries. */
public final class BordeauxTrajectoryGeneratorRegistry {
    public enum FallbackPolicy { SAFE_STOP_ONLY, VALIDATED_BRANCH }

    @FunctionalInterface
    public interface Generator {
        BordeauxGeneratedTrajectory generate(BordeauxGenerationContext context, BordeauxArguments arguments);
    }

    record Entry(Set<String> parameterNames, BordeauxTrajectoryGeneratorLimits limits,
            FallbackPolicy fallbackPolicy, Generator generator) {}

    private final Map<String, Entry> entries;
    private final String catalogId;
    private final String catalogHash;

    private BordeauxTrajectoryGeneratorRegistry(Map<String, Entry> entries, String catalogId, String catalogHash) {
        this.entries = Map.copyOf(entries);
        this.catalogId = catalogId;
        this.catalogHash = catalogHash;
    }

    public static Builder builder() { return new Builder(); }

    public static BordeauxTrajectoryGeneratorRegistry empty(String catalogId, String catalogHash) {
        return builder().catalogId(catalogId).catalogHash(catalogHash).build();
    }

    Entry resolve(String id) {
        Entry entry = entries.get(id);
        if (entry == null) throw new BordeauxRuntimeException("Unknown Bordeaux trajectory generator ID '" + id + "'");
        return entry;
    }

    BordeauxGeneratedTrajectory invokeRaw(String id, BordeauxGenerationContext context, ObjectNode values) {
        Entry entry = resolve(id);
        BordeauxArguments arguments = new BordeauxArguments(id, values);
        arguments.assertOnly(entry.parameterNames());
        return entry.generator().generate(Objects.requireNonNull(context, "context"), arguments);
    }

    public String catalogId() { return catalogId; }
    public String catalogHash() { return catalogHash; }

    public static final class Builder {
        private final Map<String, Entry> entries = new LinkedHashMap<>();
        private String catalogId;
        private String catalogHash;

        public Builder catalogId(String value) {
            if (value == null || value.isBlank() || value.length() > 256) throw new IllegalArgumentException("Catalog ID is invalid");
            catalogId = value;
            return this;
        }

        public Builder catalogHash(String value) {
            if (value == null || !value.matches("sha256:[0-9a-f]{64}")) throw new IllegalArgumentException("Catalog hash is invalid");
            catalogHash = value;
            return this;
        }

        public Builder register(String id, Set<String> parameterNames, BordeauxTrajectoryGeneratorLimits limits,
                FallbackPolicy fallbackPolicy, Generator generator) {
            if (id == null || !id.matches("[A-Za-z0-9_.:#()$,-]{1,256}")) throw new IllegalArgumentException("Generator ID is invalid");
            Entry entry = new Entry(Set.copyOf(parameterNames), Objects.requireNonNull(limits, "limits"),
                    Objects.requireNonNull(fallbackPolicy, "fallbackPolicy"), Objects.requireNonNull(generator, "generator"));
            if (entries.putIfAbsent(id, entry) != null) throw new IllegalArgumentException("Duplicate Bordeaux trajectory generator ID '" + id + "'");
            return this;
        }

        public BordeauxTrajectoryGeneratorRegistry build() {
            if (catalogId == null || catalogHash == null) throw new IllegalStateException("Catalog identity is required");
            return new BordeauxTrajectoryGeneratorRegistry(entries, catalogId, catalogHash);
        }
    }
}
