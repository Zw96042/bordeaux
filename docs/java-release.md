# Java vendordep releases

BordeauxLib uses the standard WPILib vendordep format. The public `BordeauxLib2026.json` points GradleRIO at a Maven-layout repository on the persistent `java-maven` branch, while the desktop release keeps the two bundled jars as an offline fallback.

## Release process

1. Set `bordeauxVersion` and `bordeauxFrcYear` in `java/gradle.properties`. Keep the support version used by the desktop installer, annotation processor, and trajectory reader in sync; `npm run build:java-release` rejects mismatches.
2. Run `npm run test:java-vendordep`. This builds the release bundle, has a clean GradleRIO project install the descriptor through its `vendordep` task, runs the desktop support installation, generates the command catalog, and verifies the robot fat JAR.
3. Run the normal repository checks and review the generated `java/build/release/BordeauxLib<year>.json` plus Maven artifacts.
4. Create and push the exact tag `java-v<version>`. The Java release workflow verifies the tag and repository license, refuses to replace immutable artifacts, then publishes the Maven tree and current vendordep JSON to `java-maven`.

Do not reuse a released version. Gradle and local caches assume Maven coordinates are immutable, and the staging script rejects changed bytes at an existing coordinate. Update `bordeauxFrcYear` and the vendordep template name together for a new WPILib season.

The workflow intentionally has no credential beyond GitHub's scoped contents token and performs no deployment from a developer machine. The repository and published Maven artifacts use the Apache License 2.0; the release verifier requires matching repository, npm, and POM metadata.
