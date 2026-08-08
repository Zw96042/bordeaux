package dev.bordeaux.runtime;

import java.util.List;
import java.util.Objects;

/** The selected path and its stable, time-ordered command events. */
public record BordeauxPathEvents(
        String id,
        String name,
        double totalTimeS,
        String catalogId,
        String catalogHash,
        List<BordeauxEvent> events,
        List<BordeauxSample> samples,
        List<BordeauxFollowSection> followSections,
        BordeauxRoutine routine) {
    public BordeauxPathEvents {
        events = List.copyOf(events);
        samples = List.copyOf(samples);
        followSections = List.copyOf(followSections);
        routine = Objects.requireNonNull(routine, "routine");
    }

    public BordeauxPathEvents(
            String id,
            String name,
            double totalTimeS,
            String catalogId,
            String catalogHash,
            List<BordeauxEvent> events,
            List<BordeauxSample> samples,
            List<BordeauxFollowSection> followSections) {
        this(id, name, totalTimeS, catalogId, catalogHash, events, samples, followSections, BordeauxRoutine.empty());
    }

    public BordeauxPathEvents(
            String id,
            String name,
            double totalTimeS,
            String catalogId,
            String catalogHash,
            List<BordeauxEvent> events) {
        this(id, name, totalTimeS, catalogId, catalogHash, events, List.of(), List.of(), BordeauxRoutine.empty());
    }
}
