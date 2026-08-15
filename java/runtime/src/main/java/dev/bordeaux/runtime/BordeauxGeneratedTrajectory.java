package dev.bordeaux.runtime;

import java.util.List;

/** Raw immutable samples returned by a team generator before runtime containment validates them. */
public record BordeauxGeneratedTrajectory(List<BordeauxSample> samples) {
    public BordeauxGeneratedTrajectory {
        samples = List.copyOf(samples);
    }
}
