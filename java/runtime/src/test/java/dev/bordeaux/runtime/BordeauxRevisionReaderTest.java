package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class BordeauxRevisionReaderTest {
    private static final String CATALOG_ID = "test-robot";
    private static final String HASH = "sha256:" + "a".repeat(64);
    private static final BordeauxRuntimeCompatibility COMPATIBILITY = new BordeauxRuntimeCompatibility(
            CATALOG_ID, HASH, "0.1.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");

    @Test
    void validatesEveryPathAndEveryDeployableRoutineBranch() {
        String document = trajectory("""
                ,"routine":{"name":"Auto","nodes":[{"id":"decision","type":"decision","cond":"ready",
                "then":[{"id":"first","type":"path","ref":"first"}],
                "else":[{"id":"bad","type":"path","ref":"missing"}]}]}
                ,"paths":[
                  {"id":"first","name":"First","totalTimeS":1,"samples":[],"events":[]},
                  {"id":"second","name":"Second","totalTimeS":1,"samples":[],"events":[
                    {"eventId":"late","name":"Late","timeS":2,"fraction":0,"commandId":"score","arguments":{},"cancelOnPathEnd":false}
                  ]}]
                """);

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(document), COMPATIBILITY));

        assertTrue(exception.getMessage().contains("after path totalTimeS"), exception::getMessage);
    }

    @Test
    void acceptsAuthoritativeCatalogSchemaAndSupportPairWhileDirectReadKeepsLegacyCompatibility() {
        BordeauxRuntimeCompatibility current = new BordeauxRuntimeCompatibility(
                CATALOG_ID, HASH, "0.2.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
        String currentDocument = trajectory(",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]")
                .replace("\"schemaVersion\":\"1.0\"", "\"schemaVersion\":\"1.1\"")
                .replace("\"supportVersion\":\"0.1.0\"", "\"supportVersion\":\"0.2.0\"");

        BordeauxTrajectoryReader.validateDocument(bytes(currentDocument), current);
        assertEquals("auto", BordeauxTrajectoryReader.read(new ByteArrayInputStream(bytes(trajectory(
                ",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]"))), "auto").id());
        BordeauxRuntimeException mismatch = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(currentDocument.replace("\"schemaVersion\":\"1.1\"", "\"schemaVersion\":\"1.0\"")), current));
        assertTrue(mismatch.getMessage().contains("schema/support"), mismatch::getMessage);
    void validatedStreamRejectsOversizedInputBeforeParsing() {
        var oversized = new ByteArrayInputStream(new byte[BordeauxTrajectoryReader.MAX_BYTES + 1]);

        BordeauxRuntimeException failure = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.read(oversized, "auto", COMPATIBILITY));

        assertTrue(failure.getMessage().contains("exceeds the " + BordeauxTrajectoryReader.MAX_BYTES));
    }

    @Test
    void validatesTheWaitBuiltInAgainstTheCurrentCatalogSchemaAndSupportPair() {
        BordeauxRuntimeCompatibility current = new BordeauxRuntimeCompatibility(
                CATALOG_ID, HASH, "0.3.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
        String currentDocument = trajectory("""
                ,"routine":{"name":"Wait","nodes":[
                  {"id":"wait","type":"builtin","builtinId":"bordeaux.wait","arguments":{"durationS":0.25}}]}
                ,"paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]
                """)
                .replace("\"schemaVersion\":\"1.0\"", "\"schemaVersion\":\"1.2\"")
                .replace("\"supportVersion\":\"0.1.0\"", "\"supportVersion\":\"0.3.0\"");

        BordeauxTrajectoryReader.validateDocument(bytes(currentDocument), current);
    }

    @Test
    void validatesGeneratedTrajectoryNodesAgainstTheExactCurrentCatalogPair() {
        BordeauxRuntimeCompatibility current = new BordeauxRuntimeCompatibility(
                CATALOG_ID, HASH, "0.4.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
        String currentDocument = trajectory("""
                ,"routine":{"name":"Dynamic","nodes":[
                  {"id":"dynamic","type":"generatedTrajectory","generatorId":"detour","arguments":{},
                   "fallback":{"type":"safeStop"}}]}
                ,"paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]
                """)
                .replace("\"schemaVersion\":\"1.0\"", "\"schemaVersion\":\"1.3\"")
                .replace("\"supportVersion\":\"0.1.0\"", "\"supportVersion\":\"0.4.0\"");

        BordeauxTrajectoryReader.validateDocument(bytes(currentDocument), current);
        assertThrows(BordeauxRuntimeException.class, () -> BordeauxTrajectoryReader.validateDocument(
                bytes(currentDocument.replace("\"schemaVersion\":\"1.3\"", "\"schemaVersion\":\"1.2\"")), current));
    }

    @Test
    void rejectsInvalidRoutineBranchesEvenWhenEveryPathIsOtherwiseValid() {
        String document = trajectory("""
                ,"routine":{"name":"Auto","nodes":[{"id":"decision","type":"decision","cond":"ready",
                "then":[{"id":"first","type":"path","ref":"first"}],
                "else":[{"id":"bad","type":"path","ref":"missing"}]}]}
                ,"paths":[{"id":"first","name":"First","totalTimeS":1,"samples":[],"events":[]}]
                """);

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(document), COMPATIBILITY));

        assertTrue(exception.getMessage().contains("does not match an exported path ID"), exception::getMessage);
    }

    @Test
    void rejectsDuplicateEventIdsAcrossDifferentPaths() {
        String document = trajectory("""
                ,"paths":[
                  {"id":"first","name":"First","totalTimeS":1,"samples":[],"events":[
                    {"eventId":"shared","name":"First","timeS":0,"fraction":0,"commandId":"score","arguments":{},"cancelOnPathEnd":false}]},
                  {"id":"second","name":"Second","totalTimeS":1,"samples":[],"events":[
                    {"eventId":"shared","name":"Second","timeS":0,"fraction":0,"commandId":"score","arguments":{},"cancelOnPathEnd":false}]}
                ]
                """);

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(document), COMPATIBILITY));

        assertTrue(exception.getMessage().contains("Duplicate event ID 'shared'"), exception::getMessage);
    }

    @Test
    void preservesLegacySelectedPathReadingButFullValidationRejectsMalformedUnselectedPaths() {
        String document = trajectory("""
                ,"routine":{"name":"Legacy","nodes":[{"id":"stop","type":"function","cat":"terminate","title":"Stop"}]}
                ,"paths":[
                  {"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]},
                  {"id":"bad","name":"Bad","totalTimeS":1,"samples":[],"events":[
                    {"eventId":"late","name":"Late","timeS":2,"fraction":0,"commandId":"score","arguments":{},"cancelOnPathEnd":false}
                  ]}]
                """);

        BordeauxPathEvents selected = BordeauxTrajectoryReader.read(new ByteArrayInputStream(bytes(document)), "auto");

        assertEquals("auto", selected.id());
        assertTrue(selected.routine().nodes().isEmpty());
        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(document), COMPATIBILITY));
        assertTrue(exception.getMessage().contains("after path totalTimeS"), exception::getMessage);
    }

    @Test
    void rejectsPathAndRoutineNodeCountsAboveTheRobotSafeLimits() {
        StringBuilder paths = new StringBuilder();
        for (int index = 0; index <= BordeauxTrajectoryReader.MAX_PATHS; index++) {
            if (index > 0) paths.append(',');
            paths.append("{\"id\":\"path-").append(index)
                    .append("\",\"name\":\"Path\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}");
        }
        BordeauxRuntimeException pathLimit = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(trajectory(",\"paths\":[" + paths + "]")), COMPATIBILITY));
        assertTrue(pathLimit.getMessage().contains("$.paths exceeds the limit"), pathLimit::getMessage);

        StringBuilder nodes = new StringBuilder();
        for (int index = 0; index <= BordeauxTrajectoryReader.MAX_ROUTINE_NODES; index++) {
            if (index > 0) nodes.append(',');
            nodes.append("{\"id\":\"node-").append(index).append("\",\"type\":\"path\",\"ref\":\"auto\"}");
        }
        String routineDocument = trajectory(",\"routine\":{\"name\":\"Large\",\"nodes\":[" + nodes + "]}"
                + ",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]");
        BordeauxRuntimeException nodeLimit = assertThrows(BordeauxRuntimeException.class,
                () -> BordeauxTrajectoryReader.validateDocument(bytes(routineDocument), COMPATIBILITY));
        assertTrue(nodeLimit.getMessage().contains("Routine exceeds the node limit"), nodeLimit::getMessage);
    }

    @Test
    void validatesRevisionEnvelopeAgainstPayloadAndCompiledCompatibility() {
        String payload = trajectory(",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]");
        String envelope = revision(payload, sha256(payload), CATALOG_ID, "nonce-1");

        BordeauxRevision revision = BordeauxRevisionReader.validate(
                new ByteArrayInputStream(bytes(envelope)), COMPATIBILITY);

        assertEquals(revisionId(payload), revision.revisionId());
        assertEquals("nonce-1", revision.activationNonce());
        assertEquals(payload, new String(revision.payload(), StandardCharsets.UTF_8));
        assertEquals(revision.revisionId(), BordeauxRevisionReader.revisionIdForPayload(revision.payload(), COMPATIBILITY));
    }

    @Test
    void rejectsRevisionIntegrityCompatibilityAndDuplicateKeyFailures() {
        String payload = trajectory(",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]");

        BordeauxRuntimeException checksum = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(revision(payload,
                        "sha256:" + "A".repeat(64), CATALOG_ID, "nonce-1"))), COMPATIBILITY));
        assertTrue(checksum.getMessage().contains("lowercase"), checksum::getMessage);

        BordeauxRuntimeException alteredPayload = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(revision(payload,
                        "sha256:" + "b".repeat(64), CATALOG_ID, "nonce-1"))), COMPATIBILITY));
        assertTrue(alteredPayload.getMessage().contains("does not match the decoded payload"), alteredPayload::getMessage);

        BordeauxRuntimeException catalog = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(revision(payload, sha256(payload), "other-robot", "nonce-1"))), COMPATIBILITY));
        assertTrue(catalog.getMessage().contains("catalog ID"), catalog::getMessage);

        String duplicate = revision(payload, sha256(payload), CATALOG_ID, "nonce-1")
                .replace("\"revisionId\":\"" + revisionId(payload) + "\"",
                        "\"revisionId\":\"" + revisionId(payload) + "\",\"revisionId\":\"other\"");
        BordeauxRuntimeException duplicateKey = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(duplicate)), COMPATIBILITY));
        assertTrue(duplicateKey.getMessage().toLowerCase().contains("duplicate"), duplicateKey::getMessage);
    }

    @Test
    void rejectsMalformedEnvelopeValuesAndPayloadCompatibilityMismatches() {
        String payload = trajectory(",\"paths\":[{\"id\":\"auto\",\"name\":\"Auto\",\"totalTimeS\":1,\"samples\":[],\"events\":[]}]");
        String valid = revision(payload, sha256(payload), CATALOG_ID, "nonce-1");

        BordeauxRuntimeException base64 = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(valid.replaceFirst(
                        "\\\"payload\\\":\\\"[^\\\"]+", "\\\"payload\\\":\\\"***"))), COMPATIBILITY));
        assertTrue(base64.getMessage().contains("base64"), base64::getMessage);

        BordeauxRuntimeException field = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(valid.replace(
                        "\"field\":{\"id\":\"2026-rebuilt\"", "\"field\":{\"id\":\"other-field\""))), COMPATIBILITY));
        assertTrue(field.getMessage().contains("field ID"), field::getMessage);

        BordeauxRuntimeException support = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(valid.replace(
                        "\"supportVersion\":\"0.1.0\"", "\"supportVersion\":\"9.9.9\""))), COMPATIBILITY));
        assertTrue(support.getMessage().contains("support version"), support::getMessage);

        String catalogMismatchPayload = payload.replace("\"catalogId\":\"test-robot\"", "\"catalogId\":\"other-robot\"");
        BordeauxRuntimeException payloadCatalog = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(revision(catalogMismatchPayload,
                        sha256(catalogMismatchPayload), CATALOG_ID, "nonce-1"))), COMPATIBILITY));
        assertTrue(payloadCatalog.getMessage().contains("Trajectory catalog ID"), payloadCatalog::getMessage);

        String fieldMismatchPayload = payload.replace("\"id\":\"2026-rebuilt\"", "\"id\":\"other-field\"");
        BordeauxRuntimeException payloadField = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(revision(fieldMismatchPayload,
                        sha256(fieldMismatchPayload), CATALOG_ID, "nonce-1"))), COMPATIBILITY));
        assertTrue(payloadField.getMessage().contains("Trajectory field ID"), payloadField::getMessage);

        BordeauxRuntimeException expectedActive = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new ByteArrayInputStream(bytes(valid.replace(
                        "\"expectedActiveRevisionId\":null", "\"expectedActiveRevisionId\":\"not-a-revision\""))), COMPATIBILITY));
        assertTrue(expectedActive.getMessage().contains("expectedActiveRevisionId"), expectedActive::getMessage);
    }

    @Test
    void rejectsAnOuterRevisionStreamAboveTheByteLimitWithoutBuildingItInMemory() {
        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class, () ->
                BordeauxRevisionReader.validate(new RepeatingEnvelopeInputStream(
                        BordeauxRevisionReader.MAX_REVISION_BYTES + 1L), COMPATIBILITY));

        assertTrue(exception.getMessage().contains("byte limit"), exception::getMessage);
    }

    private static String trajectory(String suffix) {
        return """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                 "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                 "field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"}%s}
                """.formatted(suffix);
    }

    private static String revision(String payload, String payloadHash, String catalogId, String nonce) {
        String encoded = Base64.getEncoder().encodeToString(bytes(payload));
        String revisionId = revisionId(payloadHash, catalogId);
        return """
                {"protocolVersion":"bordeaux-revision/1.0",
                 "revision":{"revisionId":"%s","payloadSha256":"%s",
                 "catalog":{"catalogId":"%s","catalogHash":"%s","supportVersion":"0.1.0"},
                 "field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"},
                 "payloadEncoding":"base64","payload":"%s"},
                 "activation":{"nonce":"%s","expectedActiveRevisionId":null}}
                """.formatted(revisionId, payloadHash, catalogId, HASH, encoded, nonce);
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String sha256(String value) {
        try {
            return "sha256:" + java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes(value)));
        } catch (NoSuchAlgorithmException exception) {
            throw new AssertionError(exception);
        }
    }

    private static String revisionId(String payload) {
        return revisionId(sha256(payload), CATALOG_ID);
    }

    private static String revisionId(String payloadHash, String catalogId) {
        return sha256("""
                {"protocolVersion":"bordeaux-revision/1.0","payloadSha256":"%s","catalog":{"catalogId":"%s","catalogHash":"%s","supportVersion":"0.1.0"},"field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"}}
                """.formatted(payloadHash, catalogId, HASH).strip());
    }

    private static final class RepeatingEnvelopeInputStream extends InputStream {
        private final long spaces;
        private long position;

        private RepeatingEnvelopeInputStream(long spaces) {
            this.spaces = spaces;
        }

        @Override
        public int read() {
            if (position == 0) {
                position++;
                return '{';
            }
            if (position <= spaces) {
                position++;
                return ' ';
            }
            return -1;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            int first = read();
            if (first < 0) return -1;
            buffer[offset] = (byte) first;
            int count = 1;
            while (count < length) {
                int value = read();
                if (value < 0) break;
                buffer[offset + count++] = (byte) value;
            }
            return count;
        }
    }
}
