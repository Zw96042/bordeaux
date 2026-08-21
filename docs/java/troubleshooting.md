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
before advancing into `CommandWaiting`, `Waiting`, or `Generating`, and stop exactly once at terminal completion,
safe-stop, cancellation, or close. Do not wait for the next motion node to zero the previous output.

### The runner asks for caller-driven progress

The convenience `start()`/`completePath(...)` API is only for routines without commands, waits, or generated
trajectories. Use `startProgress()`, `completePathProgress(...)`,
`completeGeneratedTrajectoryProgress(...)`, and `periodic()` for the full routine state machine.
Treat `Path` and `GeneratedTrajectory` as motion work, `CommandWaiting`, `Waiting`, and `Generating` as periodic work,
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
