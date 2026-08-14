package dev.bordeaux.runtime;

import java.util.Optional;
import java.util.function.Supplier;

/** Package-private persistence seam for deterministic runtime activation failure tests. */
interface BordeauxRevisionStorage {
    Optional<byte[]> readState();

    void writeRevision(String revisionId, byte[] payload);

    void writeState(byte[] state);

    boolean revisionMatches(String revisionId, String payloadSha256);

    <T> T withExclusiveLock(Supplier<T> action);
}
