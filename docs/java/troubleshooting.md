# Troubleshooting the Java integration

Start at the boundary nearest the failure: catalog generation, export and load, command scheduling,
drivetrain state, vision, or generated-trajectory containment. Bordeaux rejects incompatible input
before it schedules a command or releases generated samples, so the first exception is usually the
most useful one.

For the normal setup sequence, see [Getting started](getting-started.md). The
[compile-checked example gallery](../../java/examples/README.md) contains the smallest working
version of each vendor-neutral integration.

## Catalog and command discovery

### A command appears in source preview but not in the editor

Source preview is advisory. The generated catalog is authoritative.

1. Make the provider type public.
2. Expose either a public annotated command factory method, a public final `Command` field, or a
   public final `Supplier<? extends Command>` field.
3. Run the fixed project task:

   ```text
   ./gradlew bordeauxCatalog --no-daemon --console=plain
   ```

4. Confirm that `build/bordeaux/catalog-v1.json` contains the stable command ID.
5. Rebuild the catalog in Bordeaux before exporting again.

Compilation errors from the annotation processor are intentional contract checks. Fix the reported
provider, return type, duplicate ID, or unsupported parameter shape instead of hand-editing the
catalog. The [command guide](commands.md) lists the supported exposure patterns, and
[`ExistingCommandProvider`](../../java/examples/src/main/java/dev/bordeaux/examples/commands/ExistingCommandProvider.java)
shows all three.

### “Trajectory catalog ID/hash does not match”

The JSON was exported against a different compiled capability set. Treat the catalog and export as
one versioned pair:

1. build the catalog from the exact robot source being deployed;
2. load that catalog in Bordeaux;
3. export the project again; and
4. deploy both the robot program and the new JSON.

Do not weaken or bypass this check. It prevents an old event ID or argument schema from invoking the
wrong robot behavior.

### “Unknown Bordeaux command/condition/generator ID”

Pass every non-static provider compiled into the catalog to the same
`BordeauxBindings.generatedCapabilities(...)` call, even if the current export does not reference all
of them. Then rebuild and re-export. Provider order does not matter, but omitting a provider does. If
the ID exists only in a handwritten registry or an old catalog, it is not part of the compiled
capability set.

## Export and trajectory loading

### The exported file cannot be found on the robot

Linked-project exports are written to:

```text
src/main/deploy/bordeaux/<project>.bordeaux.json
```

At runtime, resolve the same `bordeaux` directory below `Filesystem.getDeployDirectory()`:

```java
var file = Filesystem.getDeployDirectory().toPath()
    .resolve("bordeaux")
    .resolve("example.bordeaux.json");
```

The short [`RobotContainerSnippet`](../../java/examples/RobotContainerSnippet.java) demonstrates
this lookup and full-document validation. GradleRIO deploys the file; Bordeaux does not deploy robot
code or files itself.

### A path selector is missing or ambiguous

Pass the exported stable path ID when possible.
`BordeauxTrajectoryReader.read(input, selector, compatibility)` accepts an ID or name, but
duplicate display names are ambiguous. Inspect the export rather than guessing a renamed path. For
an Auto-tab routine, use the validated `readWithRoutine(...)` overload instead of selecting one path
and expecting the routine graph to be retained.

### The validated reader rejects the JSON before autonomous starts

Keep the rejection. Common causes are:

- a trajectory schema, support version, field identity, or coordinate schema mismatch;
- duplicate path, node, or event IDs;
- malformed samples or event windows;
- a routine branch that references a missing exported path; or
- a document that exceeds a runtime resource limit.

Use the three-argument `read(input, selector, compatibility)` or
`readWithRoutine(input, selector, compatibility)` overload so acquisition is capped at 16 MiB and
catalog/field identity plus every path and deployable routine branch are checked before motion. The
two-argument streaming overload selects one path and is not a substitute for this full-document
preflight. Rebuild and export from a compatible Bordeaux version; do not patch schema or hash fields
by hand.
The exact compatibility invariants are listed in the
[Java command contract](../java-commands.md#contract-invariants).

## WPILib command lifecycle

### A command runs once, will not restart, or stops from another binding

A concrete `Command` object has one WPILib lifecycle. If a trigger, chooser, autonomous group, and
Bordeaux might schedule independently, expose a `Supplier<? extends Command>` so every Bordeaux
invocation receives a fresh instance. Use one public final `Command` field only when all owners are
mutually exclusive.

Do not expose an instance that was already composed into a command group. Expose the group or a
factory that creates the intended top-level behavior. See [Connecting existing commands](commands.md)
for the decision rule.

### Event commands remain scheduled after a path ends

Only events authored with **Cancel at path end** are owned and canceled by
`BordeauxEventRunner.endPath()`. Other commands intentionally keep their normal WPILib lifecycle.
Always call `endPath()` before replacing a runner; otherwise the old runner cannot apply its
cancellation policy. The compile-checked snippet above shows the replacement sequence.

### Events repeat, skip, or fire at the wrong progress

- Supply the same monotonic elapsed path time used by the follower.
- Supply monotonic measured progress for position-triggered events.
- Reset the runner before reusing it for another run.
- Do not move elapsed time backward; end/reset and start a new lifecycle instead.

The runtime catches up repeated events through their authored window, so normal loop jitter should
not skip them. A non-monotonic clock or two different notions of path progress will still produce
incorrect behavior.

## Drivetrain and pose

### The robot follows the reference in the wrong direction

`BordeauxSample.headingRad()` is the robot's physical heading. Holonomic travel direction comes from
`fieldVelocityXMps()` and `fieldVelocityYMps()`, not from where the robot is facing. A controller
that projects translation along robot heading cannot strafe and rotate independently.

The shipped `BordeauxReferenceFollower` returns a complete reference but does not own a drivetrain
controller. Preserve the team's existing holonomic controller or path-tool command while migrating.
The command-returning Bordeaux holonomic follower is staged, not a current production API.

### State is noisy or internally inconsistent

Publish corrected pose, measured robot-relative speeds, and their source timestamp as one snapshot.
Do not read pose and velocity on separate loops and stamp both with the current time. Use the
[`AtomicDriveStateCache`](../../java/examples/src/main/java/dev/bordeaux/examples/drive/AtomicDriveStateCache.java)
pattern when the vendor callback and robot loop differ.

The source timestamp must use FPGA seconds. Convert vendor time domains before constructing
`BordeauxDriveState`; do not merely rename a device timestamp.

### A drive request is rejected

`BordeauxDriveAdapter` rejects non-finite or over-limit robot-relative chassis speeds before they
reach hardware. Check the combined translation magnitude and angular velocity against the robot's
real limits. The adapter does not infer acceleration from successive calls; generated-path
containment uses separately supplied `BordeauxTrajectoryGeneratorLimits`.

Start with the [drivetrain and localization guide](drivetrain-and-localization.md) and the
[`MethodReferenceDriveAdapter`](../../java/examples/src/main/java/dev/bordeaux/examples/drive/MethodReferenceDriveAdapter.java)
example.

## Vision and pose correction

### Vision makes pose jump or drift

Verify all of these before tuning gains:

- the pose uses the same field origin and coordinate convention as odometry;
- the timestamp is the source's documented estimator time converted to FPGA seconds—normally image
  capture time, but QuestNav documents its NetworkTables data-reception timestamp for estimation;
- X, Y, and heading standard deviations are finite, positive, and match the observation quality;
- stale, off-field, impossible, or high-ambiguity observations are rejected; and
- exactly one estimator owns fusion and pose reset.

If a CTRE or YAGSL drivetrain already owns a fused estimator, forward observations to it rather than
creating a second competing estimator in Bordeaux. PhotonVision, Limelight, and QuestNav do not
share one universal covariance policy; the team must derive uncertainty from its camera geometry and
quality metrics.

Use
[`VisionObservationFactory.tryFromCaptureTimestamp`](../../java/examples/src/main/java/dev/bordeaux/examples/vision/VisionObservationFactory.java)
to keep malformed external data out of the robot loop, then follow the
[vision hardware recipes](../../java/examples/hardware/vision.md).

## Aquitaine and generated trajectories

### A generated step takes its fallback or safe-stops

Containment releases no partial trajectory. The robot loop receives only a bounded failure outcome,
not the generator worker's internal exception. Add safe team-side diagnostics around generator input
and output during development, and check these common causes:

- the generator exceeded its deadline or threw;
- current pose or field-relative velocity did not match the generated start;
- a sample was non-finite, out of order, or outside the field;
- duration, distance, velocity, acceleration, angular velocity, or curvature exceeded the stricter
  descriptor/robot limit;
- a swept segment failed collision validation; or
- the declared fallback was itself incompatible.

Supply current state immediately before generation and map the same robot constants into
`BordeauxTrajectoryGeneratorLimits`; `BordeauxDriveLimits` is not automatically converted. Leave
margin below hard limits so normal sensor noise and numerical differentiation do not turn a nominal
maximum into a rejection.

[`ContainedGeneratedRoutine`](../../java/examples/src/main/java/dev/bordeaux/examples/generation/ContainedGeneratedRoutine.java)
shows the safety construction, while
[`AquitaineRoutineLoop`](../../java/examples/src/main/java/dev/bordeaux/examples/generation/AquitaineRoutineLoop.java)
shows caller-driven progress and follower stop ownership. The full lifecycle is described in
[Aquitaine and generated paths](aquitaine-and-generated-paths.md).

### A routine pauses while the drivetrain keeps its last output

The caller owns the motion follower. Stop it whenever a `Path` or `GeneratedTrajectory` completes,
before advancing into `Waiting` or `Generating`, and stop exactly once at terminal completion,
safe-stop, cancellation, or close. Do not wait for the next motion node to zero the previous output.

### The runner asks for caller-driven progress

The convenience `start()`/`completePath(...)` API is only for routines without waits or generated
trajectories. Use `startProgress()`, `completePathProgress(...)`,
`completeGeneratedTrajectoryProgress(...)`, and `periodic()` for the full routine state machine.
Treat `Path` and `GeneratedTrajectory` as motion work, `Waiting` and `Generating` as periodic work,
and `Complete` and `SafeStopped` as terminal.

## Vendor recipe status

The default gallery deliberately has no CTRE, REV, YAGSL, navX, Redux, PhotonVision, Limelight,
PathPlanner, Choreo, or QuestNav dependency. Read each recipe heading's verification label as follows:

- **Compile-checked** or **processor-checked** — built or annotation-processed in this repository.
- **Vendor/source/helper API verified** or **official-template recipe** — checked against the linked
  official version or source, but not compiled in Bordeaux's vendor-free build.
- **Integration sketch** — the exact distributable surface was not available to verify.

Pin the matching vendordep in the robot project and compile there. Do not interpret a verified recipe
as a promise that every vendor and season combination is binary-compatible.

## What to include in a useful bug report

Include the first exception and stack trace plus:

- Bordeaux support version, catalog ID, and catalog hash;
- exported project and stable path/node/event ID involved;
- WPILib and relevant vendor library versions;
- drivetrain state timestamp domain and camera capture timestamp domain;
- generator descriptor limits and robot safety limits, when applicable; and
- a minimal catalog/export or reproducible robot test with credentials and team secrets removed.

Do not post deploy credentials, private keys, desktop tokens, or a complete roboRIO filesystem image.
