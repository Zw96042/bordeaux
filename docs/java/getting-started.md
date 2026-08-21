
Put `@BordeauxCommand` on an existing public command factory, or expose an existing command through
a public final field. This is the smallest useful provider:

```java
import dev.bordeaux.annotations.BordeauxCommand;
import edu.wpi.first.wpilibj2.command.Command;

public final class RobotActions {
    private final Intake intake;

    public RobotActions(Intake intake) {
        this.intake = intake;
    }

    @BordeauxCommand(id = "intake.run", label = "Run intake")
    public Command runIntake() {
        return intake.runCommand();
    }
}
```

Use a stable explicit ID: exported files refer to it across builds. See [Connect existing
commands](commands.md) before exposing an already-constructed `Command`; a shared command instance
also has one shared WPILib scheduling and cancellation lifecycle.

The [compile-checked provider example](../../java/examples/src/main/java/dev/bordeaux/examples/commands/ExistingCommandProvider.java)
shows a command field, a fresh-command supplier, and a parameterized factory together.

## 3. Wire the generated capabilities

Create providers from the same subsystem instances the rest of the robot uses, then pass every
non-static provider to `BordeauxBindings.generatedCapabilities(...)`:

```java
private final Intake intake = new Intake();
private final RobotActions actions = new RobotActions(intake);
private final BordeauxCapabilities bordeaux =
        BordeauxBindings.generatedCapabilities(actions);
```

Provider order does not matter. Do not create duplicate subsystems or a second autonomous container
for Bordeaux. The generated bindings call these exact team-owned objects.

The complete wiring is kept in the template's
[`RobotContainer`](../../examples/bordeaux-template-robot/src/main/java/frc/robot/RobotContainer.java).

## 4. Build the authoritative catalog

Choose **Java → Build Command Catalog…** and approve the Gradle trust prompt. Bordeaux runs only:

```text
./gradlew bordeauxCatalog --no-daemon --console=plain
```

Team members may run `./gradlew bordeauxCatalog` directly in a trusted robot checkout. A successful
build writes `build/bordeaux/catalog-v1.json`. Rebuild after adding, removing, renaming, or changing
the parameters of an annotated capability.

Compilation failures are intentional guardrails. The processor rejects inaccessible providers,
duplicate IDs, invalid defaults or bounds, unsupported parameter shapes, and command fields that are
not final.

## 5. Author and export

After the catalog builds, select generated commands in event markers or Auto-tab Command steps. The
editor uses the generated parameter types, defaults, and bounds; source-only previews are not
exportable.

Choose **Java → Export to Robot Project…**. Bordeaux writes the export below:

```text
src/main/deploy/bordeaux/<project-name>.bordeaux.json
```

GradleRIO deploys that file with the robot project's other deploy resources. Re-export after a
catalog change so the JSON's catalog ID and hash match the robot's generated bindings.

## 6. Load events on the robot

Resolve the export through WPILib's deploy directory. Build compatibility from the generated catalog
identity and the exact field pack compiled into the robot, then use the bounded, validated stream
overload to preflight every exported path, routine branch, and field identity before selecting a
stable path ID or name. The runtime caps acquisition at 16 MiB before buffering:

```java
var file = Filesystem.getDeployDirectory().toPath()
        .resolve("bordeaux")
        .resolve("MatchAuto.bordeaux.json");
var compatibility = new BordeauxRuntimeCompatibility(
        bordeaux.catalogId(), bordeaux.catalogHash(), "0.4.0",
        "2026-rebuilt", "2026-manual-tu19-welded-4", "bordeaux-field/1.0");
BordeauxPathEvents path;
try (var input = Files.newInputStream(file)) {
    path = BordeauxTrajectoryReader.read(input, "CenterStart", compatibility);
}
bordeauxEvents = new BordeauxEventRunner(path, bordeaux);
```

Replace the field constants when the robot is built against a different certified field pack. The
two-argument `read(input, selector)` overload is useful only for an input already validated by the
caller; it selects one path and does not itself validate the document's field identity or every
unselected path.

Call `bordeauxEvents.periodic(elapsedSeconds)` once per robot loop beside the path follower. If the
path uses position-triggered events, call the overload with monotonic measured path progress as a
fraction from 0 to 1. Use the same elapsed path clock as the follower.

Always call `endPath()` before replacing a runner and when autonomous ends, teleop begins, or the
robot disables. This applies the **Cancel at path end** policy to the commands the event runner owns.
Process the final path tick before ending it so events at the endpoint are not skipped. The template's
[`Robot`](../../examples/bordeaux-template-robot/src/main/java/frc/robot/Robot.java) demonstrates
these mode transitions and error handling.

For an Auto-tab routine, use the corresponding validated
`BordeauxTrajectoryReader.readWithRoutine(input, selector, compatibility)` overload and
`BordeauxRoutineRunner`. Waits and generated-path steps use its caller-driven progress API. Follow
the [runtime lifecycle reference](../../java/README.md#runtime-lifecycle) rather than treating a
multi-step routine as a single event-only path.

## Verify the integration

From the robot project, run:

```text
./gradlew bordeauxCatalog
./gradlew test
./gradlew build
```

Before deploying, check that:

- `build/bordeaux/catalog-v1.json` contains the intended stable command IDs.
- The exported JSON exists under `src/main/deploy/bordeaux`.
- The compatibility field ID, revision, and coordinate schema match the exported field pack.
- `BordeauxBindings.generatedCapabilities(...)` receives each required provider exactly once.
- Autonomous failures are reported through the team's normal `DriverStation` error path and stop the
  active runner safely.
- Mode transitions call `endPath()`.

To exercise the workflow without changing a competition project, use the
[complete template robot](../../examples/bordeaux-template-robot/README.md). When adding hardware,
continue with the [Java gallery](../../java/examples/README.md), whose examples clearly distinguish
compile-checked code from vendor API-verified recipes.

## Common problems

**“Generated Bordeaux bindings are missing”** means support was not installed into this checkout or
the project has not compiled since annotations were added. Install support, then run
`bordeauxCatalog`.

**A command appears only as a source preview** means the last authoritative catalog does not contain
it. Fix any compiler error and rebuild the catalog.

**A provider count or type error occurs at startup** means the instances passed to
`generatedCapabilities(...)` do not match the non-static provider types compiled into the catalog.
Pass each team-owned provider once; order is irrelevant.

**The trajectory catalog does not match the robot** means the export was built against different
generated capabilities. Rebuild the catalog, reopen or refresh the linked project, and re-export.

**The export cannot be opened on the robot** usually means the filename constant does not match the
exported project name or the file was not deployed. Resolve it only below
`Filesystem.getDeployDirectory()/bordeaux` and report the resulting exception.
