package dev.bordeaux.runtime;

/** A contiguous sample interval followed from either elapsed time or measured position. */
public record BordeauxFollowSection(
        int segmentIndex,
        Mode mode,
        int startSample,
        int endSample) {
    public enum Mode { TIME, POSITION }
}
