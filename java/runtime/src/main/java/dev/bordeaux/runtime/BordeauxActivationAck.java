package dev.bordeaux.runtime;

import java.util.Objects;

/** Evidence returned only after a revision has become the active runtime revision. */
public record BordeauxActivationAck(
        String nonce,
        String revisionId,
        String payloadSha256,
        String catalogId,
        String catalogHash,
        String supportVersion,
        String runtimeId,
        int teamNumber) {
    public BordeauxActivationAck {
        nonce = required(nonce, "nonce");
        revisionId = hash(revisionId, "revisionId");
        payloadSha256 = hash(payloadSha256, "payloadSha256");
        catalogId = required(catalogId, "catalogId");
        catalogHash = hash(catalogHash, "catalogHash");
        supportVersion = required(supportVersion, "supportVersion");
        runtimeId = required(runtimeId, "runtimeId");
        if (teamNumber <= 0) throw new IllegalArgumentException("teamNumber must be positive");
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
