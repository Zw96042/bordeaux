package dev.bordeaux.runtime;

import java.util.List;

/** The selected path and its stable, time-ordered command events. */
public record BordeauxPathEvents(
        String id,
        String name,
        double totalTimeS,
        String catalogId,
        String catalogHash,
        List<BordeauxEvent> events) {
    public BordeauxPathEvents {
        events = List.copyOf(events);
    }
}
