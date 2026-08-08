package dev.bordeaux.runtime;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** One immutable command invocation resolved to exported path time. */
public record BordeauxEvent(
        String eventId,
        String name,
        double timeS,
        double fraction,
        String commandId,
        ObjectNode arguments,
        boolean cancelOnPathEnd) {}
