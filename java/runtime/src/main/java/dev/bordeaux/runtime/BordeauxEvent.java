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
        boolean cancelOnPathEnd,
        Trigger trigger,
        Double repeatEveryS,
        Double endTimeS,
        String conditionId) {
    public enum Trigger { TIME, POSITION }

    public BordeauxEvent(
            String eventId,
            String name,
            double timeS,
            double fraction,
            String commandId,
            ObjectNode arguments,
            boolean cancelOnPathEnd) {
        this(eventId, name, timeS, fraction, commandId, arguments, cancelOnPathEnd,
                Trigger.TIME, null, null, null);
    }
}
