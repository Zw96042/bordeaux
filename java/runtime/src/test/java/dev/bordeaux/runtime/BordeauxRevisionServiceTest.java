package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BordeauxRevisionServiceTest {
    private static final String CATALOG_ID = "test-robot";
    private static final String HASH = "sha256:" + "a".repeat(64);
    private static final BordeauxRuntimeCompatibility COMPATIBILITY = new BordeauxRuntimeCompatibility(
            CATALOG_ID, HASH, "0.1.0", "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");

    @TempDir
    Path temporaryDirectory;

    @Test
    void rejectsActivationWhileEnabledWithoutPersistingState() throws IOException {
        Path staged = writeEnvelope("nonce-enabled", null);
        BordeauxRevisionService service = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, () -> false, COMPATIBILITY);

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class, () -> service.activate(staged));

        assertTrue(exception.getMessage().contains("disabled"), exception::getMessage);
        assertFalse(Files.exists(temporaryDirectory.resolve("state/runtime-state.json")));
    }

    @Test
    void activatesExactPayloadAndReturnsACompleteAcknowledgment() throws IOException {
        AtomicBoolean disabled = new AtomicBoolean(true);
        Path staged = writeEnvelope("nonce-success", null);
        BordeauxRevisionService service = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, disabled::get, COMPATIBILITY);

        BordeauxActivationAck acknowledgment = service.activate(staged);
        BordeauxRuntimeStatus status = service.status();

        assertEquals("nonce-success", acknowledgment.nonce());
        assertEquals(revisionId(payload()), acknowledgment.revisionId());
        assertEquals(sha256(payload()), acknowledgment.payloadSha256());
        assertEquals(CATALOG_ID, acknowledgment.catalogId());
        assertEquals(HASH, acknowledgment.catalogHash());
        assertEquals("0.1.0", acknowledgment.supportVersion());
        assertEquals(status.runtimeId(), acknowledgment.runtimeId());
        assertEquals(9604, acknowledgment.teamNumber());
        assertEquals(acknowledgment.revisionId(), status.activeRevisionId());
        assertEquals(acknowledgment.payloadSha256(), status.activePayloadSha256());
        assertTrue(status.disabled());
        assertTrue(status.health().size() <= BordeauxRevisionService.MAX_STATUS_HEALTH);
        assertArrayEquals(bytes(payload()), Files.readAllBytes(temporaryDirectory.resolve(
                "state/revisions/" + acknowledgment.revisionId().substring("sha256:".length()) + ".bdx")));
    }

    @Test
    void rejectsStaleExpectedRevisionAndReplayedNonceWithoutChangingActiveRevision() throws IOException {
        BordeauxRevisionService service = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck first = service.activate(writeEnvelope("nonce-first", null));

        BordeauxRuntimeException stale = assertThrows(BordeauxRuntimeException.class,
                () -> service.activate(writeEnvelope("nonce-stale", "sha256:" + "b".repeat(64))));
        BordeauxRuntimeException replay = assertThrows(BordeauxRuntimeException.class,
                () -> service.activate(writeEnvelope("nonce-first", first.revisionId())));

        assertTrue(stale.getMessage().contains("expected active revision"), stale::getMessage);
        assertTrue(replay.getMessage().contains("replayed"), replay::getMessage);
        assertEquals(first.revisionId(), service.status().activeRevisionId());
    }

    @Test
    void malformedCandidateDoesNotCreateOrChangeState() throws IOException {
        Path staged = temporaryDirectory.resolve("malformed.bordeaux-revision.json");
        Files.writeString(staged, "{}", StandardCharsets.UTF_8);
        BordeauxRevisionService service = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, () -> true, COMPATIBILITY);

        assertThrows(BordeauxRuntimeException.class, () -> service.activate(staged));

        assertNull(service.status().activeRevisionId());
    }

    @Test
    void revisionAndManifestWriteFailuresPreserveThePriorActiveRevision() throws IOException {
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService initial = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck first = initial.activate(writeEnvelope("nonce-first", null));

        BordeauxRevisionStorage delegate = new FileBordeauxRevisionStorage(state);
        BordeauxRevisionService revisionFailure = new BordeauxRevisionService(
                state, 9604, () -> true, COMPATIBILITY, new FailingStorage(delegate, true, false));
        assertThrows(BordeauxRuntimeException.class,
                () -> revisionFailure.activate(writeEnvelope("nonce-revision-failure", first.revisionId())));

        BordeauxRevisionService manifestFailure = new BordeauxRevisionService(
                state, 9604, () -> true, COMPATIBILITY, new FailingStorage(delegate, false, true));
        assertThrows(BordeauxRuntimeException.class,
                () -> manifestFailure.activate(writeEnvelope("nonce-manifest-failure", first.revisionId())));

        assertEquals(first.revisionId(), new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY)
                .status().activeRevisionId());
    }

    @Test
    void restartKeepsIdentityActiveStateAndReplayProtection() throws IOException {
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService initial = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck acknowledgment = initial.activate(writeEnvelope("nonce-restart", null));

        BordeauxRevisionService restarted = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);

        assertEquals(acknowledgment.runtimeId(), restarted.status().runtimeId());
        assertEquals(acknowledgment.revisionId(), restarted.status().activeRevisionId());
        BordeauxRuntimeException replay = assertThrows(BordeauxRuntimeException.class,
                () -> restarted.activate(writeEnvelope("nonce-restart", acknowledgment.revisionId())));
        assertTrue(replay.getMessage().contains("replayed"), replay::getMessage);
    }

    @Test
    void resetChangesRuntimeIdentityPreservesActiveRevisionAndClearsReplayHistory() throws IOException {
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService service = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck acknowledgment = service.activate(writeEnvelope("nonce-reset", null));

        BordeauxRuntimeStatus reset = service.resetRuntimeIdentity();

        assertNotEquals(acknowledgment.runtimeId(), reset.runtimeId());
        assertEquals(acknowledgment.revisionId(), reset.activeRevisionId());
        BordeauxActivationAck replayAfterReset = service.activate(writeEnvelope("nonce-reset", acknowledgment.revisionId()));
        assertEquals(acknowledgment.revisionId(), replayAfterReset.revisionId());
    }

    @Test
    void boundsPersistedNonceAndReportedHealthCollections() throws IOException {
        BordeauxRevisionService service = new BordeauxRevisionService(
                temporaryDirectory.resolve("state"), 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck active = service.activate(writeEnvelope("nonce-0", null));
        for (int index = 1; index <= BordeauxRevisionService.MAX_REPLAY_NONCES + 1; index++) {
            active = service.activate(writeEnvelope("nonce-" + index, active.revisionId()));
        }

        assertTrue(service.status().health().size() <= BordeauxRevisionService.MAX_STATUS_HEALTH);
        BordeauxActivationAck expiredReplay = service.activate(writeEnvelope("nonce-0", active.revisionId()));
        assertEquals(active.revisionId(), expiredReplay.revisionId());
    }

    @Test
    void rejectsOversizedAndDuplicatePersistedState() throws IOException {
        Path stateDirectory = temporaryDirectory.resolve("state");
        Files.createDirectories(stateDirectory);
        Path state = stateDirectory.resolve("runtime-state.json");
        Files.write(state, new byte[FileBordeauxRevisionStorage.MAX_STATE_BYTES + 1]);
        BordeauxRevisionService service = new BordeauxRevisionService(stateDirectory, 9604, () -> true, COMPATIBILITY);
        BordeauxRuntimeException oversized = assertThrows(BordeauxRuntimeException.class, service::status);
        assertTrue(oversized.getMessage().contains("size limit"), oversized::getMessage);

        Files.writeString(state, """
                {"version":1,"runtimeId":"00000000-0000-0000-0000-000000000001",
                "runtimeId":"00000000-0000-0000-0000-000000000002",
                "activeRevisionId":null,"activePayloadSha256":null,"recentNonces":[]}
                """, StandardCharsets.UTF_8);
        BordeauxRuntimeException duplicate = assertThrows(BordeauxRuntimeException.class, service::status);
        assertTrue(duplicate.getMessage().toLowerCase().contains("duplicate"), duplicate::getMessage);
    }

    @Test
    void readsVersionOneStateWithoutAnAcknowledgementRecoveryRecord() throws IOException {
        Path stateDirectory = temporaryDirectory.resolve("state");
        Files.createDirectories(stateDirectory);
        String active = "sha256:" + "b".repeat(64);
        Files.writeString(stateDirectory.resolve("runtime-state.json"), """
                {"version":1,"runtimeId":"00000000-0000-0000-0000-000000000001",
                "activeRevisionId":"%s","activePayloadSha256":"%s","recentNonces":["nonce-old"]}
                """.formatted(active, active), StandardCharsets.UTF_8);

        BordeauxRuntimeStatus status = new BordeauxRevisionService(stateDirectory, 9604, () -> true, COMPATIBILITY).status();

        assertEquals(active, status.activeRevisionId());
        assertTrue(status.health().stream().anyMatch(message -> message.contains("missing or corrupt")));
    }

    @Test
    void rejectsMalformedVersionTwoAcknowledgementStateWithABoundedRuntimeError() throws IOException {
        Path stateDirectory = temporaryDirectory.resolve("state");
        Files.createDirectories(stateDirectory);
        Files.writeString(stateDirectory.resolve("runtime-state.json"), """
                {"version":2,"runtimeId":"00000000-0000-0000-0000-000000000001",
                "activeRevisionId":null,"activePayloadSha256":null,"recentNonces":[],"latestActivation":[]}
                """, StandardCharsets.UTF_8);

        BordeauxRuntimeException exception = assertThrows(BordeauxRuntimeException.class,
                () -> new BordeauxRevisionService(stateDirectory, 9604, () -> true, COMPATIBILITY).status());

        assertTrue(exception.getMessage().contains("Persisted Bordeaux runtime state is invalid"), exception::getMessage);
        assertTrue(exception.getMessage().contains("latest activation"), exception::getMessage);
    }

    @Test
    void serializesCompareAndSwapAcrossServiceInstances() throws Exception {
        Path state = temporaryDirectory.resolve("state");
        new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY).status();
        CoordinatedStorage storage = new CoordinatedStorage(new FileBordeauxRevisionStorage(state));
        BordeauxRevisionService first = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY, storage);
        BordeauxRevisionService second = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY, storage);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<BordeauxActivationAck> firstResult = executor.submit(() -> first.activate(writeEnvelope("nonce-cas-a", null)));
            Future<BordeauxActivationAck> secondResult = executor.submit(() -> second.activate(writeEnvelope("nonce-cas-b", null)));
            int successes = 0;
            int stale = 0;
            for (Future<BordeauxActivationAck> result : List.of(firstResult, secondResult)) {
                try {
                    result.get();
                    successes++;
                } catch (ExecutionException exception) {
                    assertTrue(exception.getCause() instanceof BordeauxRuntimeException);
                    assertTrue(exception.getCause().getMessage().contains("expected active revision"));
                    stale++;
                }
            }
            assertEquals(1, successes);
            assertEquals(1, stale);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void boundsStoredRevisionVerificationAndReportsMissingActivePayload() throws IOException {
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionService service = new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY);
        BordeauxActivationAck active = service.activate(writeEnvelope("nonce-storage", null));
        Path payload = state.resolve("revisions/" + active.revisionId().substring("sha256:".length()) + ".bdx");

        try (RandomAccessFile file = new RandomAccessFile(payload.toFile(), "rw")) {
            file.setLength(BordeauxRevisionReader.MAX_PAYLOAD_BYTES + 1L);
        }
        BordeauxRuntimeException oversized = assertThrows(BordeauxRuntimeException.class,
                () -> service.activate(writeEnvelope("nonce-storage-next", active.revisionId())));
        assertTrue(oversized.getMessage().contains("size limit"), oversized::getMessage);

        Files.delete(payload);
        BordeauxRuntimeStatus status = service.status();
        assertTrue(status.health().stream().anyMatch(message -> message.contains("missing or corrupt")));
    }

    @Test
    void rechecksDisabledBeforeCommitAndRequiresDisabledIdentityReset() throws IOException {
        AtomicBoolean disabled = new AtomicBoolean(true);
        Path state = temporaryDirectory.resolve("state");
        BordeauxRevisionStorage delegate = new FileBordeauxRevisionStorage(state);
        BordeauxRevisionStorage flipAfterRevision = new DelegatingStorage(delegate) {
            @Override
            public void writeRevision(String revisionId, byte[] payload) {
                super.writeRevision(revisionId, payload);
                disabled.set(false);
            }
        };
        BordeauxRevisionService service = new BordeauxRevisionService(
                state, 9604, disabled::get, COMPATIBILITY, flipAfterRevision);

        assertThrows(BordeauxRuntimeException.class, () -> service.activate(writeEnvelope("nonce-flip", null)));
        assertNull(new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY).status().activeRevisionId());
        assertThrows(BordeauxRuntimeException.class, service::resetRuntimeIdentity);
    }

    private Path writeEnvelope(String nonce, String expectedActiveRevisionId) throws IOException {
        Path staged = temporaryDirectory.resolve(nonce + ".bordeaux-revision.json");
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

    private static final class FailingStorage implements BordeauxRevisionStorage {
        private final BordeauxRevisionStorage delegate;
        private final boolean failRevision;
        private final boolean failState;

        private FailingStorage(BordeauxRevisionStorage delegate, boolean failRevision, boolean failState) {
            this.delegate = delegate;
            this.failRevision = failRevision;
            this.failState = failState;
        }

        @Override
        public Optional<byte[]> readState() {
            return delegate.readState();
        }

        @Override
        public void writeRevision(String revisionId, byte[] payload) {
            if (failRevision) throw new BordeauxRuntimeException("Injected immutable revision write failure");
            delegate.writeRevision(revisionId, payload);
        }

        @Override
        public byte[] readRevision(String revisionId, String payloadSha256) {
            return delegate.readRevision(revisionId, payloadSha256);
        }

        @Override
        public void deleteRevision(String revisionId) { delegate.deleteRevision(revisionId); }

        @Override
        public boolean revisionPresent(String revisionId) { return delegate.revisionPresent(revisionId); }

        @Override
        public void writeState(byte[] state) {
            if (failState) throw new BordeauxRuntimeException("Injected active manifest move failure");
            delegate.writeState(state);
        }

        @Override
        public boolean revisionMatches(String revisionId, String payloadSha256) {
            return delegate.revisionMatches(revisionId, payloadSha256);
        }

        @Override
        public <T> T withExclusiveLock(Supplier<T> action) {
            return delegate.withExclusiveLock(action);
        }
    }

    private static class DelegatingStorage implements BordeauxRevisionStorage {
        protected final BordeauxRevisionStorage delegate;

        private DelegatingStorage(BordeauxRevisionStorage delegate) {
            this.delegate = delegate;
        }

        @Override
        public Optional<byte[]> readState() { return delegate.readState(); }

        @Override
        public void writeRevision(String revisionId, byte[] payload) { delegate.writeRevision(revisionId, payload); }

        @Override
        public byte[] readRevision(String revisionId, String payloadSha256) { return delegate.readRevision(revisionId, payloadSha256); }

        @Override
        public void deleteRevision(String revisionId) { delegate.deleteRevision(revisionId); }

        @Override
        public boolean revisionPresent(String revisionId) { return delegate.revisionPresent(revisionId); }

        @Override
        public void writeState(byte[] state) { delegate.writeState(state); }

        public boolean revisionMatches(String revisionId, String payloadSha256) {
            return delegate.revisionMatches(revisionId, payloadSha256);
        }

        public <T> T withExclusiveLock(Supplier<T> action) { return delegate.withExclusiveLock(action); }
    }

    private static final class CoordinatedStorage extends DelegatingStorage {
        private final CountDownLatch reads = new CountDownLatch(2);
        private final ReentrantLock transaction = new ReentrantLock();
        private final ThreadLocal<Boolean> inTransaction = ThreadLocal.withInitial(() -> false);

        private CoordinatedStorage(BordeauxRevisionStorage delegate) {
            super(delegate);
        }

        @Override
        public Optional<byte[]> readState() {
            if (!inTransaction.get()) {
                reads.countDown();
                try { reads.await(); }
                catch (InterruptedException exception) { throw new AssertionError(exception); }
            }
            return super.readState();
        }

        public <T> T withExclusiveLock(Supplier<T> action) {
            transaction.lock();
            try {
                inTransaction.set(true);
                return action.get();
            } finally {
                inTransaction.remove();
                transaction.unlock();
            }
        }
    }
}
