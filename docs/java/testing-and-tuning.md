known-good revision after invalid input, and disabled-only geometry/hard-limit changes. Those are
design constraints, not behavior available from the current Java runtime.

## Repository checks

From `java/`, run focused Java verification:

```text
./gradlew :runtime:test :examples:test
```

Before release, run the full Java build:

```text
./gradlew test
./gradlew build
```

The [Java example gallery](../../java/examples/README.md) identifies which examples are
compile-checked, vendor-interface verified, or integration sketches. The
[template robot](../../examples/bordeaux-template-robot/README.md) is the GradleRIO integration
fixture; its README lists the catalog, test, build, and simulation commands expected after support is
installed.
