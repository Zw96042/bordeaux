package dev.bordeaux.runtime;

import java.util.Objects;

/** Compiled robot identities a deployed revision must match before it can run. */
public record BordeauxRuntimeCompatibility(
        String catalogId,
        String catalogHash,
        String supportVersion,
        String fieldId,
        String fieldRevision,
        String fieldCoordinateSchemaId) {
    public BordeauxRuntimeCompatibility {
        catalogId = required(catalogId, "catalogId");
        catalogHash = hash(catalogHash, "catalogHash");
        supportVersion = required(supportVersion, "supportVersion");
        fieldId = required(fieldId, "fieldId");
        fieldRevision = required(fieldRevision, "fieldRevision");
        fieldCoordinateSchemaId = required(fieldCoordinateSchemaId, "fieldCoordinateSchemaId");
    }

    private static String required(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank()) throw new IllegalArgumentException(name + " is required");
        return value;
    }

    private static String hash(String value, String name) {
        required(value, name);
        if (!value.matches("sha256:[0-9a-f]{64}")) {
            throw new IllegalArgumentException(name + " must use sha256:<64 lowercase hex characters>");
        }
        return value;
    }
}
