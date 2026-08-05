package dev.bordeaux.generated;

import dev.bordeaux.runtime.BordeauxCommandRegistry;

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
                .build();
    }
}
