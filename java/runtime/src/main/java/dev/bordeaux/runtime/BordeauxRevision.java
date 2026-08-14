package dev.bordeaux.runtime;

import java.util.Arrays;
import java.util.Objects;

/** A fully validated revision envelope, ready for an activation policy to consume. */
public record BordeauxRevision(
        String revisionId,
        String payloadSha256,
        byte[] payload,
        String activationNonce,
        String expectedActiveRevisionId) {
    public BordeauxRevision {
        revisionId = requiredHash(revisionId, "revisionId");
        payloadSha256 = requiredHash(payloadSha256, "payloadSha256");
        payload = Arrays.copyOf(Objects.requireNonNull(payload, "payload"), payload.length);
        activationNonce = Objects.requireNonNull(activationNonce, "activationNonce");
        if (!activationNonce.matches("[A-Za-z0-9._:-]{1,256}")) {
            throw new IllegalArgumentException("activationNonce must use [A-Za-z0-9._:-]{1,256}");
        }
        if (expectedActiveRevisionId != null) requiredHash(expectedActiveRevisionId, "expectedActiveRevisionId");
    }

    @Override
    public byte[] payload() {
        return Arrays.copyOf(payload, payload.length);
    }

    private static String requiredHash(String value, String name) {
        Objects.requireNonNull(value, name);
        if (!value.matches("sha256:[0-9a-f]{64}")) {
            throw new IllegalArgumentException(name + " must use sha256:<64 lowercase hex characters>");
        }
        return value;
    }
}
