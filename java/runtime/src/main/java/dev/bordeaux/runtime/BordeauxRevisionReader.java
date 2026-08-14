package dev.bordeaux.runtime;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HexFormat;

/** Strict, bounded reader for the transportable Bordeaux revision envelope 1.0. */
public final class BordeauxRevisionReader {
    static final int MAX_REVISION_BYTES = 24 * 1024 * 1024;
    static final int MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

    private static final ObjectMapper MAPPER = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder()
                    .maxNestingDepth(40)
                    .maxStringLength(MAX_REVISION_BYTES)
                    .maxNumberLength(1_000)
                    .build())
            .build());

    private BordeauxRevisionReader() {}

    /**
     * Validates one immutable revision without activating it or constructing any team command.
     */
    public static BordeauxRevision validate(InputStream input, BordeauxRuntimeCompatibility compatibility) {
        if (input == null) throw new BordeauxRuntimeException("Revision input is required");
        if (compatibility == null) throw new BordeauxRuntimeException("Runtime compatibility is required");
        ObjectNode envelope = readEnvelope(input);
        if (!"bordeaux-revision/1.0".equals(text(envelope, "protocolVersion", "$"))) {
            throw new BordeauxRuntimeException("$.protocolVersion must be exactly 'bordeaux-revision/1.0'");
        }
        ObjectNode revision = object(envelope.get("revision"), "$.revision must be an object");
        String revisionId = hash(text(revision, "revisionId", "$.revision"), "$.revision.revisionId");
        String payloadSha256 = hash(text(revision, "payloadSha256", "$.revision"), "$.revision.payloadSha256");
        ObjectNode catalog = object(revision.get("catalog"), "$.revision.catalog must be an object");
        validateCatalog(catalog, compatibility);
        ObjectNode field = object(revision.get("field"), "$.revision.field must be an object");
        validateField(field, compatibility);
        if (!"base64".equals(text(revision, "payloadEncoding", "$.revision"))) {
            throw new BordeauxRuntimeException("$.revision.payloadEncoding must be exactly 'base64'");
        }
        byte[] payload = decodePayload(text(revision, "payload", "$.revision"));
        if (!payloadSha256.equals(sha256(payload))) {
            throw new BordeauxRuntimeException("$.revision.payloadSha256 does not match the decoded payload");
        }
        String expectedRevisionId = revisionId(payloadSha256, catalog, field);
        if (!revisionId.equals(expectedRevisionId)) {
            throw new BordeauxRuntimeException("$.revision.revisionId does not match the immutable revision metadata");
        }
        ObjectNode activation = object(envelope.get("activation"), "$.activation must be an object");
        String nonce = text(activation, "nonce", "$.activation");
        if (!nonce.matches("[A-Za-z0-9._:-]{1,256}")) {
            throw new BordeauxRuntimeException("$.activation.nonce must use [A-Za-z0-9._:-]{1,256}");
        }
        JsonNode expectedNode = activation.get("expectedActiveRevisionId");
        if (expectedNode == null || !(expectedNode.isNull() || expectedNode.isTextual())) {
            throw new BordeauxRuntimeException("$.activation.expectedActiveRevisionId must be a revision ID or null");
        }
        String expectedActiveRevisionId = expectedNode.isNull() ? null
                : hash(expectedNode.textValue(), "$.activation.expectedActiveRevisionId");

        BordeauxTrajectoryReader.validateDocument(payload, compatibility);
        return new BordeauxRevision(revisionId, payloadSha256, payload, nonce, expectedActiveRevisionId);
    }

    private static ObjectNode readEnvelope(InputStream input) {
        try (JsonParser parser = MAPPER.createParser(new BoundedInputStream(input, MAX_REVISION_BYTES))) {
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new BordeauxRuntimeException("$ must be a JSON object");
            }
            ObjectNode envelope = object(MAPPER.readTree(parser), "$ must be a JSON object");
            if (parser.nextToken() != null) {
                throw new BordeauxRuntimeException("Could not parse Bordeaux revision JSON: trailing JSON value");
            }
            return envelope;
        } catch (BordeauxRuntimeException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not parse Bordeaux revision JSON: " + exception.getMessage(), exception);
        }
    }

    private static byte[] decodePayload(String encoded) {
        byte[] payload;
        try {
            payload = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new BordeauxRuntimeException("$.revision.payload must be valid base64", exception);
        }
        if (payload.length > MAX_PAYLOAD_BYTES) {
            throw new BordeauxRuntimeException("Decoded revision payload exceeds the " + MAX_PAYLOAD_BYTES + " byte limit");
        }
        if (!Base64.getEncoder().encodeToString(payload).equals(encoded)) {
            throw new BordeauxRuntimeException("$.revision.payload must use canonical base64 encoding");
        }
        return payload;
    }

    private static void validateCatalog(ObjectNode catalog, BordeauxRuntimeCompatibility compatibility) {
        String catalogId = text(catalog, "catalogId", "$.revision.catalog");
        if (catalogId.length() > 256) throw new BordeauxRuntimeException("$.revision.catalog.catalogId exceeds 256 characters");
        String catalogHash = hash(text(catalog, "catalogHash", "$.revision.catalog"), "$.revision.catalog.catalogHash");
        String supportVersion = text(catalog, "supportVersion", "$.revision.catalog");
        if (!compatibility.catalogId().equals(catalogId)) {
            throw new BordeauxRuntimeException("Revision catalog ID does not match the compiled robot catalog");
        }
        if (!compatibility.catalogHash().equals(catalogHash)) {
            throw new BordeauxRuntimeException("Revision catalog hash does not match the compiled robot catalog");
        }
        if (!compatibility.supportVersion().equals(supportVersion)) {
            throw new BordeauxRuntimeException("Revision catalog support version does not match the compiled robot support");
        }
    }

    private static void validateField(ObjectNode field, BordeauxRuntimeCompatibility compatibility) {
        if (!compatibility.fieldId().equals(text(field, "id", "$.revision.field"))) {
            throw new BordeauxRuntimeException("Revision field ID does not match the compiled robot field");
        }
        if (!compatibility.fieldRevision().equals(text(field, "revision", "$.revision.field"))) {
            throw new BordeauxRuntimeException("Revision field revision does not match the compiled robot field");
        }
        if (!compatibility.fieldCoordinateSchemaId().equals(text(field, "coordinateSchemaId", "$.revision.field"))) {
            throw new BordeauxRuntimeException("Revision field coordinate schema does not match the compiled robot field");
        }
    }

    private static String revisionId(String payloadSha256, ObjectNode catalog, ObjectNode field) {
        ObjectNode metadata = JsonNodeFactory.instance.objectNode();
        metadata.put("protocolVersion", "bordeaux-revision/1.0");
        metadata.put("payloadSha256", payloadSha256);
        ObjectNode metadataCatalog = metadata.putObject("catalog");
        metadataCatalog.put("catalogId", text(catalog, "catalogId", "$.revision.catalog"));
        metadataCatalog.put("catalogHash", text(catalog, "catalogHash", "$.revision.catalog"));
        metadataCatalog.put("supportVersion", text(catalog, "supportVersion", "$.revision.catalog"));
        ObjectNode metadataField = metadata.putObject("field");
        metadataField.put("id", text(field, "id", "$.revision.field"));
        metadataField.put("revision", text(field, "revision", "$.revision.field"));
        metadataField.put("coordinateSchemaId", text(field, "coordinateSchemaId", "$.revision.field"));
        try {
            return sha256(MAPPER.writeValueAsBytes(metadata));
        } catch (IOException exception) {
            throw new BordeauxRuntimeException("Could not canonicalize revision metadata", exception);
        }
    }

    private static String sha256(byte[] value) {
        try {
            return "sha256:" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException exception) {
            throw new BordeauxRuntimeException("SHA-256 is unavailable", exception);
        }
    }

    private static ObjectNode object(JsonNode value, String message) {
        if (!(value instanceof ObjectNode object)) throw new BordeauxRuntimeException(message);
        return object;
    }

    private static String text(JsonNode owner, String field, String context) {
        JsonNode value = owner.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new BordeauxRuntimeException(context + "." + field + " must be a nonempty string");
        }
        return value.textValue();
    }

    private static String hash(String value, String path) {
        if (!value.matches("sha256:[0-9a-f]{64}")) {
            throw new BordeauxRuntimeException(path + " must use sha256:<64 lowercase hex characters>");
        }
        return value;
    }

    private static final class BoundedInputStream extends InputStream {
        private final InputStream delegate;
        private final long maxBytes;
        private long read;

        private BoundedInputStream(InputStream delegate, long maxBytes) {
            this.delegate = delegate;
            this.maxBytes = maxBytes;
        }

        @Override
        public int read() throws IOException {
            int value = delegate.read();
            if (value >= 0) add(1);
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = delegate.read(buffer, offset, length);
            if (count > 0) add(count);
            return count;
        }

        private void add(long count) throws IOException {
            read += count;
            if (read > maxBytes) throw new IOException("revision exceeds the " + maxBytes + " byte limit");
        }
    }
}
