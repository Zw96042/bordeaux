package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BordeauxRobotMailboxServiceTest {
    private static final String CATALOG_ID = "test-robot";
    private static final String HASH = "sha256:" + "a".repeat(64);
    private static final BordeauxRuntimeCompatibility COMPATIBILITY = new BordeauxRuntimeCompatibility(
            CATALOG_ID, HASH, "0.1.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path temporaryDirectory;

    @Test
    void callerPollActivatesOneInboxRevisionAndPublishesAnExactActiveAcknowledgement() throws IOException {
        Path namespace = namespace();
        BordeauxRevisionService revisions = revisions(true);
        Path inbox = namespace.resolve("inbox/nonce-active.bordeaux-revision.json");
        Files.writeString(inbox, envelope("nonce-active", null), StandardCharsets.UTF_8);
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, revisions);

        mailbox.periodic();

        JsonNode acknowledgement = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/nonce-active.json")));
        assertEquals("bordeaux-robot-push/1.0", acknowledgement.path("protocolVersion").textValue());
        assertEquals("active", acknowledgement.path("state").textValue());
        assertEquals("nonce-active", acknowledgement.path("nonce").textValue());
        assertEquals(revisionId(payload()), acknowledgement.path("revisionId").textValue());
        assertEquals(sha256(payload()), acknowledgement.path("payloadSha256").textValue());
        assertEquals(CATALOG_ID, acknowledgement.path("catalogId").textValue());
        assertEquals(HASH, acknowledgement.path("catalogHash").textValue());
        assertEquals("0.1.0", acknowledgement.path("supportVersion").textValue());
        assertEquals(9604, acknowledgement.path("teamNumber").intValue());
        assertTrue(acknowledgement.path("runtimeId").isTextual());
        assertFalse(Files.exists(inbox));
        JsonNode status = MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")));
        assertEquals(acknowledgement.path("revisionId").textValue(), status.path("activeRevisionId").textValue());
    }

    @Test
    void rejectedDisabledStaleAndMalformedCandidatesKeepThePriorActiveRevision() throws IOException {
        Path namespace = namespace();
        AtomicBoolean disabled = new AtomicBoolean(true);
        BordeauxRevisionService revisions = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, disabled::get, COMPATIBILITY);
        BordeauxActivationAck prior = revisions.activate(writeStaged("nonce-prior", null));
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, revisions);

        disabled.set(false);
        Files.writeString(namespace.resolve("inbox/nonce-disabled.bordeaux-revision.json"),
                envelope("nonce-disabled", prior.revisionId()), StandardCharsets.UTF_8);
        mailbox.periodic();
        JsonNode enabledStatus = MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")));
        assertFalse(enabledStatus.path("disabled").booleanValue());
        assertEquals("rejected", MAPPER.readTree(Files.readAllBytes(
                namespace.resolve("acks/nonce-disabled.json"))).path("state").textValue());
        assertFalse(Files.exists(namespace.resolve("inbox/nonce-disabled.bordeaux-revision.json")));
        disabled.set(true);
        Files.writeString(namespace.resolve("inbox/nonce-stale.bordeaux-revision.json"),
                envelope("nonce-stale", "sha256:" + "b".repeat(64)), StandardCharsets.UTF_8);
        Files.writeString(namespace.resolve("inbox/nonce-malformed.bordeaux-revision.json"), "{}", StandardCharsets.UTF_8);
        mailbox.periodic();

        for (String nonce : new String[] {"nonce-disabled", "nonce-stale", "nonce-malformed"}) {
            JsonNode acknowledgement = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/" + nonce + ".json")));
            assertEquals("rejected", acknowledgement.path("state").textValue());
            assertEquals("activation", acknowledgement.path("boundary").textValue());
            assertTrue(acknowledgement.path("message").textValue().length() <= 512);
        }
        assertEquals(prior.revisionId(), revisions.status().activeRevisionId());
    }

    @Test
    void rejectsAnEnvelopeWhoseNonceDoesNotMatchItsInboxFileNameBeforeActivation() throws IOException {
        Path namespace = namespace();
        BordeauxRevisionService revisions = revisions(true);
        Files.writeString(namespace.resolve("inbox/nonce-file.bordeaux-revision.json"),
                envelope("nonce-envelope", null), StandardCharsets.UTF_8);

        new BordeauxRobotMailboxService(namespace, revisions).periodic();

        JsonNode acknowledgement = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/nonce-file.json")));
        assertEquals("rejected", acknowledgement.path("state").textValue());
        assertTrue(acknowledgement.path("message").textValue().contains("file name"));
        assertNull(revisions.status().activeRevisionId());
    }

    @Test
    void recoversAnActiveAcknowledgementAfterTheFirstAcknowledgementWriteFails() throws IOException {
        Path namespace = namespace();
        BordeauxRevisionService revisions = revisions(true);
        Path candidate = namespace.resolve("inbox/nonce-recover.bordeaux-revision.json");
        Files.writeString(candidate, envelope("nonce-recover", null), StandardCharsets.UTF_8);
        Files.createDirectory(namespace.resolve("acks/nonce-recover.json"));
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, revisions);

        assertThrows(BordeauxRuntimeException.class, mailbox::periodic);
        assertEquals(revisionId(payload()), revisions.status().activeRevisionId());
        assertTrue(Files.exists(candidate));

        Files.delete(namespace.resolve("acks/nonce-recover.json"));
        BordeauxRevisionService restarted = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, () -> true, COMPATIBILITY);
        new BordeauxRobotMailboxService(namespace, restarted).periodic();

        JsonNode acknowledgement = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/nonce-recover.json")));
        assertEquals("active", acknowledgement.path("state").textValue());
        assertEquals(revisionId(payload()), acknowledgement.path("revisionId").textValue());
        assertEquals(revisions.status().runtimeId(), acknowledgement.path("runtimeId").textValue());
        assertFalse(Files.exists(candidate));
    }

    @Test
    void rejectsSymlinkCandidatesWithoutFollowingThemAndBoundsInboxEnumeration() throws IOException {
        Path namespace = namespace();
        Path outside = Files.writeString(temporaryDirectory.resolve("outside-revision.json"), envelope("nonce-link", null));
        try {
            Files.createSymbolicLink(namespace.resolve("inbox/nonce-link.bordeaux-revision.json"), outside);
        } catch (UnsupportedOperationException exception) {
            return;
        }
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, revisions(true));

        mailbox.periodic();

        assertEquals("rejected", MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/nonce-link.json")))
                .path("state").textValue());
        assertEquals(envelope("nonce-link", null), Files.readString(outside));
        for (int index = 0; index <= BordeauxRobotMailboxService.MAX_INBOX_ENTRIES; index++) {
            Files.writeString(namespace.resolve("inbox/ignored-" + index), "x");
        }
        assertThrows(BordeauxRuntimeException.class, mailbox::periodic);
        assertTrue(Files.isRegularFile(namespace.resolve("status.json")));
    }

    private Path namespace() throws IOException {
        Path namespace = Files.createDirectory(temporaryDirectory.resolve("push-v1"));
        Files.createDirectory(namespace.resolve("inbox"));
        Files.createDirectory(namespace.resolve("acks"));
        return namespace;
    }

    private BordeauxRevisionService revisions(boolean disabled) {
        return new BordeauxRevisionService(temporaryDirectory.resolve("state"), 9604, () -> disabled, COMPATIBILITY);
    }

    private Path writeStaged(String nonce, String expectedActiveRevisionId) throws IOException {
        Path staged = temporaryDirectory.resolve(nonce + ".json");
        Files.writeString(staged, envelope(nonce, expectedActiveRevisionId), StandardCharsets.UTF_8);
        return staged;
    }

    private static String payload() {
        return """
                {"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux",
                "catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                "field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"},
                "paths":[{"id":"auto","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]}
                """.strip();
    }

    private static String envelope(String nonce, String expectedActiveRevisionId) {
        String payload = payload();
        String encoded = Base64.getEncoder().encodeToString(bytes(payload));
        return """
                {"protocolVersion":"bordeaux-revision/1.0",
                "revision":{"revisionId":"%s","payloadSha256":"%s",
                "catalog":{"catalogId":"test-robot","catalogHash":"%s","supportVersion":"0.1.0"},
                "field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"},
                "payloadEncoding":"base64","payload":"%s"},
                "activation":{"nonce":"%s","expectedActiveRevisionId":%s}}
                """.formatted(revisionId(payload), sha256(payload), HASH, encoded, nonce,
                        expectedActiveRevisionId == null ? "null" : "\"" + expectedActiveRevisionId + "\"");
    }

    private static String revisionId(String payload) {
        return sha256("""
                {"protocolVersion":"bordeaux-revision/1.0","payloadSha256":"%s","catalog":{"catalogId":"test-robot","catalogHash":"%s","supportVersion":"0.1.0"},"field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"}}
                """.formatted(sha256(payload), HASH).strip());
    }

    private static String sha256(String value) {
        try {
            return "sha256:" + java.util.HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes(value)));
        } catch (NoSuchAlgorithmException exception) {
            throw new AssertionError(exception);
        }
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
