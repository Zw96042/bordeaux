# Bordeaux template robot

This is a complete 2026 command-based GradleRIO project for trying Bordeaux Java commands and
cataloging a bounded Aquitaine path-generator provider. It intentionally does not commit Bordeaux
support JARs: install them through the desktop app exactly as a real robot project would.

Read the [Java getting-started guide](../../docs/java/getting-started.md) for the surrounding workflow,
or follow the project-specific steps below.

## First-time setup

1. Build Bordeaux from the repository root with `npm run build` and open the current app.
2. Open `BordeauxExample.bordeaux.json` from this directory. It is the project used by the example
   robot; add or inspect event markers against the generated catalog.
3. Choose **Java → Link Robot Project…** and select this `bordeaux-template-robot` directory.
4. Choose **Java → Install or Update Support…**, review the managed Gradle changes, and approve them.
5. Choose **Java → Build Command Catalog…** and approve the fixed Gradle task. Add or select an Event
   Marker or Auto-tab Command step to inspect the generated commands and typed parameters.
6. Choose **Java → Export to Robot Project…**. Bordeaux writes `src/main/deploy/bordeaux/Untitled.bordeaux.json`, matching the constants in `Robot.java`.
7. If you rename the Bordeaux project or path, update `TRAJECTORY_FILE` or `PATH_SELECTOR` in `Robot.java` to match.

After support installation, these commands should pass:

```text
./gradlew bordeauxCatalog
./gradlew test
./gradlew build
./gradlew simulateJava
```

Before deploying, replace team number `0` in `.wpilib/wpilib_preferences.json` with your FRC team number.

## What the example demonstrates

- `ExampleCommands` exposes stable annotated factory methods with strings, numbers, ranges, enums, and a structured record parameter.
- The same provider exposes one existing `Command` field and one `Supplier<Command>` field, showing
  how teleop/auto commands already used by the robot become Bordeaux commands without wrappers.
- `DynamicPaths` exposes a processor-checked generated-trajectory provider beginning at an injected
  fused robot pose. Its unit test covers the stopped-start contract and geometry.
- The annotation processor generates direct-call `BordeauxGeneratedBindings` and an authoritative catalog at `build/bordeaux/catalog-v1.json`.
- `RobotContainer` passes the team-owned command and generator providers through
  `BordeauxBindings.generatedCapabilities(...)`, which safely bootstraps the final-round generated
  class during clean builds, validates the complete export against the compiled catalog and field
  identity, then selects a path from the deploy directory.
- Because the template has no drivetrain, `Robot` demonstrates time-triggered events and ends at the
  authored duration. A real follower should call `updateBordeauxEvents(elapsedS, measuredFraction)`
  for time and position markers, then call `endBordeauxPath()` only when the follower reports actual
  completion. This avoids ending a lagging position-followed section merely because authored time
  elapsed.
- Commands only cancel automatically at path end when the event has **Cancel at path end** selected. `example.hold-output` is intended to demonstrate that lifecycle.

The template catalogs `DynamicPaths`, but it does not construct `BordeauxGeneratedTrajectorySafety`,
run an Aquitaine routine, implement a drivetrain, or follow Bordeaux position/generated samples.
Those pieces require robot limits, fused state, field/collision validators, and a follower; the template
does not pretend they ran merely because the provider compiled. For the complete runtime contract and
copyable CTRE, YAGSL, REV, custom swerve, IMU, vision, PathPlanner, and Choreo recipes, continue with the
[`java/examples` gallery](../../java/examples/README.md).
