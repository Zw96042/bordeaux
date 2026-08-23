package dev.bordeaux.generated;

import dev.bordeaux.runtime.BordeauxCommandRegistry;
import dev.bordeaux.runtime.BordeauxCapabilities;
import dev.bordeaux.runtime.BordeauxConditionRegistry;

public final class BordeauxGeneratedBindings {
    public static class FirstProvider {}

    public static final class SecondProvider extends FirstProvider {}

    private final FirstProvider first;
    private final SecondProvider second;

    public BordeauxGeneratedBindings(FirstProvider first, SecondProvider second) {
        this.first = first;
        this.second = second;
    }

    public BordeauxCommandRegistry registry() {
        if (first == null || second == null) throw new IllegalStateException("Providers are required");
        return BordeauxCommandRegistry.builder()
                .catalogId("test-bindings")
                .catalogHash("sha256:" + "a".repeat(64))
                .register("collect", java.util.Set.of(), arguments -> {}, arguments -> new edu.wpi.first.wpilibj2.command.Command() {})
                .build();
    }

    public BordeauxConditionRegistry conditions() {
        return BordeauxConditionRegistry.builder()
                .catalogId("test-bindings")
                .catalogHash("sha256:" + "a".repeat(64))
                .register("ready", () -> true)
                .build();
    }

    public BordeauxCapabilities capabilities() {
        return new BordeauxCapabilities(registry(), conditions());
    }
}
