package dev.bordeaux.gradle;

import org.gradle.api.provider.Property;

public abstract class BordeauxExtension {
    public abstract Property<String> getCatalogId();
}
