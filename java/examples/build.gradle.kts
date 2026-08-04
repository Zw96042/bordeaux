// Add this plugin to a normal 2026 GradleRIO robot project. It installs the
// annotation, processor, runtime dependencies and the fixed bordeauxCatalog task.
plugins {
    id("dev.bordeaux") version "0.1.0"
}

bordeaux {
    catalogId = "frc-9999-robot"
}

// `./gradlew bordeauxCatalog` now writes build/bordeaux/catalog-v1.json.
