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
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
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
    void exportsVerifiedActivePayloadFromNondefaultPrivateStorage() throws IOException {
        Path namespace = namespace();
        Path state = temporaryDirectory.resolve("custom-private-storage");
        BordeauxRevisionService revisions = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, revisions);
        mailbox.periodic();
        JsonNode empty = MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")));
        assertEquals(BordeauxRobotStatusPublisher.ACTIVE_REVISION_READ_VERSION, empty.path("activeRevisionRead").textValue());
        assertTrue(empty.path("activeRevisionId").isNull());
        assertFalse(Files.exists(namespace.resolve("active-trajectory.json")));

        Files.writeString(namespace.resolve("inbox/export.bordeaux-revision.json"), envelope("export", null));
        mailbox.periodic();
        assertEquals(payload(), Files.readString(namespace.resolve("active-trajectory.json")));
        JsonNode active = MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")));
        assertEquals(revisionId(payload()), active.path("activeRevisionId").textValue());
        assertEquals(sha256(payload()), active.path("activePayloadSha256").textValue());
        assertEquals(BordeauxRobotStatusPublisher.ACTIVE_REVISION_READ_VERSION, active.path("activeRevisionRead").textValue());
        assertFalse(active.toString().contains("custom-private-storage"));
    }

    @Test
    void missingOrCorruptRetainedPayloadDoesNotAdvertiseReadableBaseline() throws IOException {
        Path namespace = namespace();
        BordeauxRevisionService revisions = revisions(true);
        BordeauxActivationAck active = revisions.activate(writeStaged("export", null));
        Path retained = temporaryDirectory.resolve("state/revisions/" + active.revisionId().substring(7) + ".bdx");
        Files.writeString(retained, "corrupt");
        new BordeauxRobotMailboxService(namespace, revisions).periodic();
        JsonNode status = MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")));
        assertFalse(status.has("activeRevisionRead"));
        assertEquals(active.revisionId(), status.path("activeRevisionId").textValue());
        Files.delete(retained);
        new BordeauxRobotMailboxService(namespace, revisions).periodic();
        assertFalse(MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json"))).has("activeRevisionRead"));
    }

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

        FileTime unchangedMarker = FileTime.fromMillis(1_000);
        Files.setLastModifiedTime(namespace.resolve("status.json"), unchangedMarker);
        mailbox.periodic();
        assertEquals(unchangedMarker, Files.getLastModifiedTime(namespace.resolve("status.json")));
    }

    @Test
    void enabledPeriodicRejectsAnAlreadyAcceptedEnvelopeWithoutRecoveringItAsActive() throws IOException {
        Path namespace = namespace();
        AtomicBoolean disabled = new AtomicBoolean(true);
        BordeauxRevisionService revisions = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, disabled::get, COMPATIBILITY);
        BordeauxActivationAck prior = revisions.activate(writeStaged("nonce-prior", null));
        Path replay = namespace.resolve("inbox/nonce-prior.bordeaux-revision.json");
        Files.writeString(replay, envelope("nonce-prior", null), StandardCharsets.UTF_8);
        disabled.set(false);

        new BordeauxRobotMailboxService(namespace, revisions).periodic();

        JsonNode acknowledgement = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/nonce-prior.json")));
        assertEquals("rejected", acknowledgement.path("state").textValue());
        assertTrue(acknowledgement.path("message").textValue().contains("disabled"));
        assertFalse(Files.exists(replay));
        assertEquals(prior.revisionId(), revisions.status().activeRevisionId());
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

    @Test
    void processesNonceBoundRollbackAndPinControlsAndRejectsFilenameCollisions() throws IOException {
        Path namespace = namespace();
        BordeauxRevisionService revisions = revisions(true);
        BordeauxActivationAck first = revisions.activate(writeStaged("seed-first", null));
        BordeauxActivationAck second = revisions.activate(writeStaged("seed-second", first.revisionId()));
        Files.writeString(namespace.resolve("inbox/rollback.bordeaux-retention.json"), retention(
                "rollback", "rollback", second.revisionId(), first), StandardCharsets.UTF_8);

        new BordeauxRobotMailboxService(namespace, revisions).periodic();

        JsonNode rollback = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/rollback.json")));
        assertEquals("active", rollback.path("state").textValue());
        assertEquals("rollback", rollback.path("action").textValue());
        assertEquals(first.revisionId(), revisions.status().activeRevisionId());
        assertEquals(first.revisionId(), MAPPER.readTree(Files.readAllBytes(namespace.resolve("status.json")))
                .path("retention").path("revisions").get(0).path("revisionId").textValue());

        Files.writeString(namespace.resolve("inbox/collision.bordeaux-revision.json"), envelope("collision", first.revisionId()));
        Files.writeString(namespace.resolve("inbox/collision.bordeaux-retention.json"), retention(
                "collision", "pin", first.revisionId(), first));
        new BordeauxRobotMailboxService(namespace, revisions).periodic();

        JsonNode collision = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/collision.json")));
        assertEquals("rejected", collision.path("state").textValue());
        assertEquals("mailbox", collision.path("boundary").textValue());
        assertFalse(Files.exists(namespace.resolve("inbox/collision.bordeaux-revision.json")));
        assertFalse(Files.exists(namespace.resolve("inbox/collision.bordeaux-retention.json")));
    }

    @Test
    void reusesPublishedStatusIdentityForRejectedAcknowledgements() throws IOException {
        Path namespace = namespace();
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService initial = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck active = initial.activate(writeStaged("counting-seed", null));
        CountingStorage storage = new CountingStorage(new FileBordeauxRevisionStorage(state));
        BordeauxRevisionService counted = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY, storage);
        BordeauxRobotMailboxService mailbox = new BordeauxRobotMailboxService(namespace, counted);
        Files.writeString(namespace.resolve("inbox/rejected-a.bordeaux-revision.json"), "{}", StandardCharsets.UTF_8);
        Files.writeString(namespace.resolve("inbox/rejected-b.bordeaux-revision.json"), "{}", StandardCharsets.UTF_8);

        mailbox.periodic();

        assertEquals(active.revisionId(), counted.status().activeRevisionId());
        assertEquals(2, storage.revisionMatches); // Initial status publication and the explicit status assertion only.
        assertEquals(0, storage.revisionPresent);
    }

    @Test
    void recoversExactRollbackAndPinAcknowledgementsAfterAcknowledgementWriteFailure() throws IOException {
        Path namespace = namespace();
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService revisions = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck first = revisions.activate(writeStaged("recover-first", null));
        BordeauxActivationAck second = revisions.activate(writeStaged("recover-second", first.revisionId()));

        Files.writeString(namespace.resolve("inbox/recover-rollback.bordeaux-retention.json"), retention(
                "recover-rollback", "rollback", second.revisionId(), first), StandardCharsets.UTF_8);
        Files.createDirectory(namespace.resolve("acks/recover-rollback.json"));
        assertThrows(BordeauxRuntimeException.class, () -> new BordeauxRobotMailboxService(namespace, revisions).periodic());
        assertTrue(Files.exists(namespace.resolve("inbox/recover-rollback.bordeaux-retention.json")));
        Files.delete(namespace.resolve("acks/recover-rollback.json"));

        BordeauxRevisionService restarted = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        new BordeauxRobotMailboxService(namespace, restarted).periodic();
        JsonNode rollback = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/recover-rollback.json")));
        assertEquals("active", rollback.path("state").textValue());
        assertEquals("rollback", rollback.path("action").textValue());
        assertEquals(first.revisionId(), rollback.path("revisionId").textValue());

        Files.writeString(namespace.resolve("inbox/recover-pin.bordeaux-retention.json"), retention(
                "recover-pin", "pin", first.revisionId(), first), StandardCharsets.UTF_8);
        Files.createDirectory(namespace.resolve("acks/recover-pin.json"));
        assertThrows(BordeauxRuntimeException.class, () -> new BordeauxRobotMailboxService(namespace, restarted).periodic());
        Files.delete(namespace.resolve("acks/recover-pin.json"));

        new BordeauxRobotMailboxService(namespace,
                new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY)).periodic();
        JsonNode pin = MAPPER.readTree(Files.readAllBytes(namespace.resolve("acks/recover-pin.json")));
        assertEquals("pinned", pin.path("state").textValue());
        assertEquals("pin", pin.path("action").textValue());
        assertEquals(first.revisionId(), pin.path("revisionId").textValue());
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

    private static String retention(String nonce, String action, String expectedActiveRevisionId, BordeauxActivationAck target) {
        return """
                {"protocolVersion":"bordeaux-retention/1.0","action":"%s","nonce":"%s",
                "expectedActiveRevisionId":"%s","target":{"revisionId":"%s","payloadSha256":"%s"}}
                """.formatted(action, nonce, expectedActiveRevisionId, target.revisionId(), target.payloadSha256());
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

    private static final class CountingStorage implements BordeauxRevisionStorage {
        private final BordeauxRevisionStorage delegate;
        private int revisionMatches;
        private int revisionPresent;

        private CountingStorage(BordeauxRevisionStorage delegate) {
            this.delegate = delegate;
        }

        @Override public Optional<byte[]> readState() { return delegate.readState(); }
        @Override public void writeRevision(String revisionId, byte[] payload) { delegate.writeRevision(revisionId, payload); }
        @Override public byte[] readRevision(String revisionId, String payloadSha256) { return delegate.readRevision(revisionId, payloadSha256); }
        @Override public void deleteRevision(String revisionId) { delegate.deleteRevision(revisionId); }
        @Override public boolean revisionPresent(String revisionId) { revisionPresent++; return delegate.revisionPresent(revisionId); }
        @Override public void writeState(byte[] state) { delegate.writeState(state); }
        @Override public boolean revisionMatches(String revisionId, String payloadSha256) { revisionMatches++; return delegate.revisionMatches(revisionId, payloadSha256); }
        @Override public <T> T withExclusiveLock(Supplier<T> action) { return delegate.withExclusiveLock(action); }
    }
}
