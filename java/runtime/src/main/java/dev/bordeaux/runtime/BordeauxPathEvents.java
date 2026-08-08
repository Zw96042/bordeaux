package dev.bordeaux.runtime;

import java.util.List;

/** The selected path and its stable, time-ordered command events. */
public record BordeauxPathEvents(
        String id,
        String name,
        double totalTimeS,
        String catalogId,
        String catalogHash,
        List<BordeauxEvent> events,
        List<BordeauxSample> samples,
        List<BordeauxFollowSection> followSections) {
    public BordeauxPathEvents {
        events = List.copyOf(events);
        samples = List.copyOf(samples);
        followSections = List.copyOf(followSections);
    }

    public BordeauxPathEvents(
            String id,
            String name,
            double totalTimeS,
            String catalogId,
            String catalogHash,
            List<BordeauxEvent> events) {
        this(id, name, totalTimeS, catalogId, catalogHash, events, List.of(), List.of());
    }
}
