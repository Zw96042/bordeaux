package dev.bordeaux.runtime;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
        BordeauxRoutine routine,
        Map<String, List<BordeauxEvent>> routinePathEvents) {
    public BordeauxPathEvents {
        events = List.copyOf(events);
        samples = List.copyOf(samples);
        followSections = List.copyOf(followSections);
        routine = Objects.requireNonNull(routine, "routine");
        Map<String, List<BordeauxEvent>> copiedEvents = new LinkedHashMap<>();
        Objects.requireNonNull(routinePathEvents, "routinePathEvents").forEach(
                (pathId, pathEvents) -> copiedEvents.put(
                        Objects.requireNonNull(pathId, "routine path ID"), List.copyOf(pathEvents)));
        routinePathEvents = Collections.unmodifiableMap(copiedEvents);
    }

    public BordeauxPathEvents(
            String id,
            String name,
            double totalTimeS,
            String catalogId,
            String catalogHash,
            List<BordeauxEvent> events,
            List<BordeauxSample> samples,
            List<BordeauxFollowSection> followSections,
            BordeauxRoutine routine) {
        this(id, name, totalTimeS, catalogId, catalogHash, events, samples, followSections, routine,
                routine == null || routine.nodes().isEmpty() ? Map.of() : Map.of(id, events));
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
