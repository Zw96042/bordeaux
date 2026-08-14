package dev.bordeaux.runtime;

import java.util.List;
import java.util.Objects;

/** Bounded, local status for a robot team's opt-in Bordeaux revision runtime. */
public record BordeauxRuntimeStatus(
        String runtimeId,
        int teamNumber,
        boolean disabled,
        String catalogId,
        String catalogHash,
        String supportVersion,
        String fieldId,
        String fieldRevision,
        String fieldCoordinateSchemaId,
        String activeRevisionId,
        String activePayloadSha256,
        List<String> health,
        BordeauxRevisionRetention retention) {
    public BordeauxRuntimeStatus(
            String runtimeId, int teamNumber, boolean disabled, String catalogId, String catalogHash, String supportVersion,
            String fieldId, String fieldRevision, String fieldCoordinateSchemaId, String activeRevisionId,
            String activePayloadSha256, List<String> health) {
        this(runtimeId, teamNumber, disabled, catalogId, catalogHash, supportVersion, fieldId, fieldRevision,
                fieldCoordinateSchemaId, activeRevisionId, activePayloadSha256, health,
                new BordeauxRevisionRetention(BordeauxRevisionService.RECENT_LIMIT, List.of()));
    }
    public BordeauxRuntimeStatus {
        runtimeId = required(runtimeId, "runtimeId");
        if (teamNumber <= 0) throw new IllegalArgumentException("teamNumber must be positive");
        catalogId = required(catalogId, "catalogId");
        catalogHash = hash(catalogHash, "catalogHash");
        supportVersion = required(supportVersion, "supportVersion");
        fieldId = required(fieldId, "fieldId");
        fieldRevision = required(fieldRevision, "fieldRevision");
        fieldCoordinateSchemaId = required(fieldCoordinateSchemaId, "fieldCoordinateSchemaId");
        if (activeRevisionId != null) activeRevisionId = hash(activeRevisionId, "activeRevisionId");
        if (activePayloadSha256 != null) activePayloadSha256 = hash(activePayloadSha256, "activePayloadSha256");
        health = List.copyOf(Objects.requireNonNull(health, "health"));
        if (health.size() > BordeauxRevisionService.MAX_STATUS_HEALTH
                || health.stream().anyMatch(value -> value == null || value.length() > 512)) {
            throw new IllegalArgumentException("health must contain at most "
                    + BordeauxRevisionService.MAX_STATUS_HEALTH + " bounded messages");
        }
        retention = Objects.requireNonNull(retention, "retention");
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
