package dev.bordeaux.runtime;

import java.util.Optional;
import java.util.function.Supplier;

/** Package-private persistence seam for deterministic runtime activation failure tests. */
interface BordeauxRevisionStorage {
    Optional<byte[]> readState();

    void writeRevision(String revisionId, byte[] payload);

    /** Reads one exact immutable payload through the same bounded storage boundary used for activation. */
    byte[] readRevision(String revisionId, String payloadSha256);

    /** Deletes only the exact digest-derived revision file. It never enumerates or recursively removes paths. */
    void deleteRevision(String revisionId);

    void writeState(byte[] state);

    boolean revisionMatches(String revisionId, String payloadSha256);

    <T> T withExclusiveLock(Supplier<T> action);
}
