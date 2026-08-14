package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class BordeauxRevisionRetentionTest {
  private static final String HASH = "sha256:" + "a".repeat(64);
  private static final BordeauxRuntimeCompatibility COMPATIBILITY =
      new BordeauxRuntimeCompatibility(
          "test-robot",
          HASH,
          "0.1.0",
          "2026-rebuilt",
          "2026-manual-tu19-welded-4",
          "bordeaux-field/1.0");
  @TempDir Path temporaryDirectory;

  @Test
  void retainsNewestFivePlusPinnedOlderRevisionThenReleasesOnlyTheReplacedPin() throws IOException {
    BordeauxRevisionService service = service(true);
    List<BordeauxActivationAck> revisions = push(service, 1, 5, null);
    BordeauxActivationAck pinned = revisions.get(0);
    BordeauxActivationAck pin =
        service.applyRetention(
            writeControl("pin-1", "pin", revisions.get(4).revisionId(), pinned), "pin-1");
    assertEquals("pin", pin.action());
    assertEquals(pinned.revisionId(), pin.revisionId());
    revisions.addAll(push(service, 6, 10, revisions.get(4).revisionId()));

    BordeauxRuntimeStatus afterPushes = service.status();
    assertEquals(6, afterPushes.retention().revisions().size());
    assertTrue(
        afterPushes.retention().revisions().stream()
            .anyMatch(entry -> entry.revisionId().equals(pinned.revisionId()) && entry.pinned()));
    assertFalse(Files.exists(payloadPath(revisions.get(1))));
    assertFalse(Files.exists(payloadPath(revisions.get(2))));
    assertFalse(Files.exists(payloadPath(revisions.get(3))));

    BordeauxActivationAck replacement = revisions.get(6);
    service.applyRetention(
        writeControl("pin-2", "pin", revisions.get(9).revisionId(), replacement), "pin-2");

    assertFalse(Files.exists(payloadPath(pinned)));
    assertTrue(Files.exists(payloadPath(replacement)));
    assertEquals(5, service.status().retention().revisions().size());
    assertTrue(
        service.status().retention().revisions().stream()
            .anyMatch(
                entry -> entry.revisionId().equals(replacement.revisionId()) && entry.pinned()));
  }

  @Test
  void rollbackIsFreshCasCheckedAndMovesTheTargetToNewest() throws IOException {
    AtomicBoolean disabled = new AtomicBoolean(true);
    BordeauxRevisionService service = service(disabled.get(), disabled);
    List<BordeauxActivationAck> revisions = push(service, 1, 5, null);
    BordeauxActivationAck target = revisions.get(1);
    BordeauxActivationAck active = revisions.get(4);

    BordeauxActivationAck rollback =
        service.applyRetention(
            writeControl("rollback-1", "rollback", active.revisionId(), target), "rollback-1");

    assertEquals("rollback", rollback.action());
    assertEquals(target.revisionId(), service.status().activeRevisionId());
    assertEquals(target.revisionId(), service.status().retention().revisions().get(0).revisionId());
    assertThrows(
        BordeauxRuntimeException.class,
        () ->
            service.applyRetention(
                writeControl("rollback-1", "rollback", target.revisionId(), target), "rollback-1"));
    assertThrows(
        BordeauxRuntimeException.class,
        () ->
            service.applyRetention(
                writeControl("rollback-stale", "rollback", active.revisionId(), target),
                "rollback-stale"));
    disabled.set(false);
    assertThrows(
        BordeauxRuntimeException.class,
        () ->
            service.applyRetention(
                writeControl("rollback-enabled", "rollback", target.revisionId(), target),
                "rollback-enabled"));
    assertEquals(target.revisionId(), service.status().activeRevisionId());
  }

  @Test
  void legacyStateMigrationNeverEnumeratesOrDeletesUnknownHistoricalFiles() throws IOException {
    Path state = temporaryDirectory.resolve("state");
    Files.createDirectories(state.resolve("revisions"));
    String active = "sha256:" + "b".repeat(64);
    Path unknown =
        Files.writeString(state.resolve("revisions/" + "c".repeat(64) + ".bdx"), "unknown");
    Files.writeString(
        state.resolve("runtime-state.json"),
        """
{"version":2,"runtimeId":"00000000-0000-0000-0000-000000000001",
"activeRevisionId":"%s","activePayloadSha256":"%s","recentNonces":[],"latestActivation":null}
"""
            .formatted(active, active),
        StandardCharsets.UTF_8);

    BordeauxRuntimeStatus status =
        new BordeauxRevisionService(state, 9604, () -> true, COMPATIBILITY).status();

    assertEquals(active, status.activeRevisionId());
    assertTrue(Files.exists(unknown));
    assertEquals(1, status.retention().revisions().size());
    assertEquals("missing", status.retention().revisions().get(0).availability());
  }

  @Test
  void missingOrCorruptRollbackTargetAndStateWriteFailureLeaveThePriorActiveRevisionUntouched()
      throws IOException {
    BordeauxRevisionService service = service(true);
    List<BordeauxActivationAck> revisions = push(service, 1, 2, null);
    BordeauxActivationAck first = revisions.get(0);
    BordeauxActivationAck active = revisions.get(1);
    Files.delete(payloadPath(first));

    assertThrows(
        BordeauxRuntimeException.class,
        () ->
            service.applyRetention(
                writeControl("missing", "rollback", active.revisionId(), first), "missing"));
    assertEquals(active.revisionId(), service.status().activeRevisionId());

    BordeauxRevisionStorage delegate =
        new FileBordeauxRevisionStorage(temporaryDirectory.resolve("state"));
    BordeauxRevisionService writeFailure =
        new BordeauxRevisionService(
            temporaryDirectory.resolve("state"),
            9604,
            () -> true,
            COMPATIBILITY,
            new DelegatingStorage(delegate) {
              @Override
              public void writeState(byte[] contents) {
                throw new BordeauxRuntimeException("injected state failure");
              }
            });
    assertThrows(
        BordeauxRuntimeException.class,
        () ->
            writeFailure.applyRetention(
                writeControl("state-failure", "pin", active.revisionId(), active),
                "state-failure"));
    assertEquals(active.revisionId(), service.status().activeRevisionId());
    assertFalse(
        service.status().retention().revisions().stream().anyMatch(entry -> entry.pinned()));
  }

  @Test
  void cleanupFailureAfterCommitKeepsTheNewStateAndReportsBoundedHealth() throws IOException {
    BordeauxRevisionService initial = service(true);
    List<BordeauxActivationAck> revisions = push(initial, 1, 5, null);
    BordeauxRevisionStorage delegate =
        new FileBordeauxRevisionStorage(temporaryDirectory.resolve("state"));
    BordeauxRevisionService cleanupFailure =
        new BordeauxRevisionService(
            temporaryDirectory.resolve("state"),
            9604,
            () -> true,
            COMPATIBILITY,
            new DelegatingStorage(delegate) {
              @Override
              public void deleteRevision(String revisionId) {
                throw new BordeauxRuntimeException("injected cleanup failure");
              }
            });

    BordeauxActivationAck next =
        cleanupFailure.activate(writeEnvelope("push-6", revisions.get(4).revisionId(), 6));

    assertEquals(next.revisionId(), cleanupFailure.status().activeRevisionId());
    assertTrue(
        cleanupFailure.status().health().stream()
            .anyMatch(message -> message.contains("cleanup incomplete")));
    assertTrue(Files.exists(payloadPath(revisions.get(0))));
  }

  @Test
  void rejectsRetentionControlsWithTrailingJsonValues() throws IOException {
    BordeauxActivationAck target = service(true).activate(writeEnvelope("seed", null, 1));
    String control = Files.readString(writeControl("trailing", "pin", target.revisionId(), target));

    BordeauxRuntimeException exception =
        assertThrows(
            BordeauxRuntimeException.class,
            () ->
                BordeauxRetentionControl.read(
                    new ByteArrayInputStream((control + " {} ").getBytes(StandardCharsets.UTF_8))));

    assertTrue(exception.getMessage().contains("trailing"), exception::getMessage);
  }

  @Test
  void retentionStatusRejectsDuplicatePayloadsAndMultiplePinnedEntries() {
    BordeauxRevisionRetention.Entry first =
        new BordeauxRevisionRetention.Entry(hash('a'), hash('c'), "retained", true);
    BordeauxRevisionRetention.Entry duplicatePayload =
        new BordeauxRevisionRetention.Entry(hash('b'), hash('c'), "retained", false);
    BordeauxRevisionRetention.Entry secondPin =
        new BordeauxRevisionRetention.Entry(hash('b'), hash('d'), "retained", true);

    assertThrows(
        IllegalArgumentException.class,
        () ->
            new BordeauxRevisionRetention(
                BordeauxRevisionService.RECENT_LIMIT, List.of(first, duplicatePayload)));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new BordeauxRevisionRetention(
                BordeauxRevisionService.RECENT_LIMIT, List.of(first, secondPin)));
  }

  private BordeauxRevisionService service(boolean disabled) {
    return new BordeauxRevisionService(
        temporaryDirectory.resolve("state"), 9604, () -> disabled, COMPATIBILITY);
  }

  private BordeauxRevisionService service(boolean ignored, AtomicBoolean disabled) {
    return new BordeauxRevisionService(
        temporaryDirectory.resolve("state"), 9604, disabled::get, COMPATIBILITY);
  }

  private List<BordeauxActivationAck> push(
      BordeauxRevisionService service, int first, int last, String expected) throws IOException {
    List<BordeauxActivationAck> revisions = new ArrayList<>();
    String active = expected;
    for (int index = first; index <= last; index++) {
      BordeauxActivationAck next = service.activate(writeEnvelope("push-" + index, active, index));
      revisions.add(next);
      active = next.revisionId();
    }
    return revisions;
  }

  private Path writeEnvelope(String nonce, String expected, int variant) throws IOException {
    String payload = payload(variant);
    String encoded = Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    String document =
        """
{"protocolVersion":"bordeaux-revision/1.0","revision":{"revisionId":"%s","payloadSha256":"%s","catalog":{"catalogId":"test-robot","catalogHash":"%s","supportVersion":"0.1.0"},"field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"},"payloadEncoding":"base64","payload":"%s"},"activation":{"nonce":"%s","expectedActiveRevisionId":%s}}
"""
            .formatted(
                revisionId(payload),
                sha(payload),
                HASH,
                encoded,
                nonce,
                expected == null ? "null" : "\"" + expected + "\"");
    Path path = temporaryDirectory.resolve(nonce + ".bordeaux-revision.json");
    Files.writeString(path, document);
    return path;
  }

  private Path writeControl(
      String nonce, String action, String expected, BordeauxActivationAck target)
      throws IOException {
    Path path = temporaryDirectory.resolve(nonce + ".bordeaux-retention.json");
    Files.writeString(
        path,
        """
{"protocolVersion":"bordeaux-retention/1.0","action":"%s","nonce":"%s","expectedActiveRevisionId":"%s","target":{"revisionId":"%s","payloadSha256":"%s"}}
"""
            .formatted(action, nonce, expected, target.revisionId(), target.payloadSha256()));
    return path;
  }

  private Path payloadPath(BordeauxActivationAck acknowledgement) {
    return temporaryDirectory.resolve(
        "state/revisions/" + acknowledgement.revisionId().substring("sha256:".length()) + ".bdx");
  }

  private static String payload(int variant) {
    return """
{"schemaVersion":"bordeaux-trajectory/1.0","generator":"bordeaux","catalog":{"schemaVersion":"1.0","catalogId":"test-robot","supportVersion":"0.1.0","catalogHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"},"paths":[{"id":"auto-%d","name":"Auto","totalTimeS":1,"samples":[],"events":[]}]}
"""
        .formatted(variant);
  }

  private static String revisionId(String payload) {
    return sha(
        """
{"protocolVersion":"bordeaux-revision/1.0","payloadSha256":"%s","catalog":{"catalogId":"test-robot","catalogHash":"%s","supportVersion":"0.1.0"},"field":{"id":"2026-rebuilt","revision":"2026-manual-tu19-welded-4","coordinateSchemaId":"bordeaux-field/1.0"}}
"""
            .formatted(sha(payload), HASH)
            .strip());
  }

  private static String sha(String text) {
    try {
      return "sha256:"
          + java.util.HexFormat.of()
              .formatHex(
                  MessageDigest.getInstance("SHA-256")
                      .digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new AssertionError(exception);
    }
  }

  private static String hash(char character) {
    return "sha256:" + String.valueOf(character).repeat(64);
  }

  private static class DelegatingStorage implements BordeauxRevisionStorage {
    private final BordeauxRevisionStorage delegate;

    private DelegatingStorage(BordeauxRevisionStorage delegate) {
      this.delegate = delegate;
    }

    @Override
    public Optional<byte[]> readState() {
      return delegate.readState();
    }

    @Override
    public void writeRevision(String revisionId, byte[] payload) {
      delegate.writeRevision(revisionId, payload);
    }

    @Override
    public byte[] readRevision(String revisionId, String payloadSha256) {
      return delegate.readRevision(revisionId, payloadSha256);
    }

    @Override
    public void deleteRevision(String revisionId) {
      delegate.deleteRevision(revisionId);
    }

    @Override
    public void writeState(byte[] state) {
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
}
