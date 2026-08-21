
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
