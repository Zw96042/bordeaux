# Bordeaux template robot

This is a complete 2026 command-based GradleRIO project for trying Bordeaux Java commands. It intentionally does not commit Bordeaux support JARs: install them through the desktop app exactly as a real robot project would.

## First-time setup

1. Build Bordeaux from the repository root with `npm run build` and open the current app.
2. Open `BordeauxExample.bordeaux.json` from this directory. It already contains four example event markers.
3. Choose **Java → Link Robot Project…** and select this `bordeaux-template-robot` directory.
4. Choose **Java → Install or Update Support…**, review the managed Gradle changes, and approve them.
5. Choose **Java → Build Command Catalog…** and approve the fixed Gradle task. Select any Event Marker to inspect its generated command and typed parameters.
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
- The annotation processor generates direct-call `BordeauxGeneratedBindings` and an authoritative catalog at `build/bordeaux/catalog-v1.json`.
- `RobotContainer` passes the team-owned command provider through `BordeauxBindings.generated(...)`, which safely bootstraps the final-round generated class during clean builds, then loads exported JSON from the deploy directory.
- `Robot` advances command events with the autonomous elapsed time, processes the final tick, and ends the event runner at the exported path duration. A real robot should pass that same time to its drivetrain path follower.
- Commands only cancel automatically at path end when the event has **Cancel at path end** selected. `example.hold-output` is intended to demonstrate that lifecycle.

The template does not implement a drivetrain or follow Bordeaux position samples. Those details are robot-specific; the example isolates the command scheduling contract without pretending to own subsystem construction or drive control.
