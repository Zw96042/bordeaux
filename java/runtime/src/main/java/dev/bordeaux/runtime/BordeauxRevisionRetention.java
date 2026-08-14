package dev.bordeaux.runtime;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;

/** Bounded local-retention inventory exposed in robot status. */
public record BordeauxRevisionRetention(int recentLimit, List<Entry> revisions) {
  public BordeauxRevisionRetention {
    if (recentLimit != BordeauxRevisionService.RECENT_LIMIT) {
      throw new IllegalArgumentException("recentLimit is fixed");
    }
    revisions = List.copyOf(Objects.requireNonNull(revisions, "revisions"));
    if (revisions.size() > recentLimit + 1
        || new LinkedHashSet<>(revisions.stream().map(Entry::revisionId).toList()).size()
            != revisions.size()
        || new LinkedHashSet<>(revisions.stream().map(Entry::payloadSha256).toList()).size()
            != revisions.size()
        || revisions.stream().filter(Entry::pinned).count() > 1) {
      throw new IllegalArgumentException("retention revisions must be bounded and distinct");
    }
  }

  public record Entry(
      String revisionId, String payloadSha256, String availability, boolean pinned) {
    public Entry {
      if (revisionId == null
          || !revisionId.matches("sha256:[0-9a-f]{64}")
          || payloadSha256 == null
          || !payloadSha256.matches("sha256:[0-9a-f]{64}")) {
        throw new IllegalArgumentException("revision metadata must be hashes");
      }
      if (!"retained".equals(availability) && !"missing".equals(availability)) {
        throw new IllegalArgumentException("availability is invalid");
      }
    }
  }
}
