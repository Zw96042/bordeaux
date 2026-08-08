package dev.bordeaux.runtime;

import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Robot-owned mapping from stable Bordeaux IDs to fresh WPILib command factories. */
public final class BordeauxCommandRegistry {
    @FunctionalInterface
    public interface Factory {
        Command create(BordeauxArguments arguments);
    }

    private record Entry(Set<String> parameterNames, Factory factory) {}

    private final Map<String, Entry> entries;
    private final String catalogId;
    private final String catalogHash;

    private BordeauxCommandRegistry(Map<String, Entry> entries, String catalogId, String catalogHash) {
        this.entries = Map.copyOf(entries);
        this.catalogId = catalogId;
        this.catalogHash = catalogHash;
    }

    public static Builder builder() {
        return new Builder();
    }

    public Command create(String id, ObjectNode values) {
        Entry entry = entries.get(id);
        if (entry == null) {
            throw new BordeauxRuntimeException("Trajectory references unknown Bordeaux command ID '" + id + "'");
        }
        BordeauxArguments arguments = new BordeauxArguments(id, values);
        arguments.assertOnly(entry.parameterNames());
        try {
            Command command = entry.factory().create(arguments);
            if (command == null) throw new BordeauxRuntimeException("Command factory '" + id + "' returned null");
            return command;
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new BordeauxRuntimeException("Command factory '" + id + "' failed: " + exception.getMessage(), exception);
        }
    }

    public String catalogHash() {
        return catalogHash;
    }

    public String catalogId() {
        return catalogId;
    }

    public static final class Builder {
        private final Map<String, Entry> entries = new LinkedHashMap<>();
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

        public Builder register(String id, Set<String> parameterNames, Factory factory) {
            if (id == null || id.isBlank()) throw new IllegalArgumentException("Command ID is required");
            Objects.requireNonNull(parameterNames, "parameterNames");
            Objects.requireNonNull(factory, "factory");
            Entry previous = entries.putIfAbsent(id, new Entry(Set.copyOf(parameterNames), factory));
            if (previous != null) throw new IllegalArgumentException("Duplicate Bordeaux command ID '" + id + "'");
            return this;
        }

        public BordeauxCommandRegistry build() {
            if (catalogId == null) throw new IllegalStateException("Catalog ID is required");
            if (catalogHash == null) throw new IllegalStateException("Catalog hash is required");
            return new BordeauxCommandRegistry(entries, catalogId, catalogHash);
        }
    }
}
