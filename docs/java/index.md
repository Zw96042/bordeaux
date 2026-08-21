# Bordeaux Java

Bordeaux connects the WPILib commands a team already owns to authored paths and autonomous
routines. It does not replace `RobotContainer`, construct subsystems, or take over the command
scheduler.

## How the pieces fit

1. The robot project marks team-owned commands and conditions with Bordeaux annotations.
2. The annotation processor creates direct-call Java bindings and a typed command catalog.
3. The desktop app uses that catalog while the team authors events and routine steps.
4. Exported JSON carries the catalog ID and hash it was authored against.
5. The robot loads the JSON, verifies that identity, and schedules the original team commands.

The built catalog is authoritative. Source discovery in the desktop app is only a preview; a command
is not exportable until `bordeauxCatalog` compiles it successfully.

## What owns what today

| Capability | Current owner |
| --- | --- |
| WPILib command construction and scheduling | Team code plus generated Bordeaux bindings; shipped |
| Static path and event references | Bordeaux readers/runners; shipped, with motion followed by team code |
| Aquitaine decisions, waits, generation, fallback, and safe stop | Bordeaux routine runtime; shipped through caller-driven progress |
| Modules, IMU, corrected pose, and vision fusion | The robot's existing drivetrain/estimator behind the shipped adapter seam |
| Holonomic feedback controller and command lifecycle | Team, PathPlanner, or Choreo code today; a Bordeaux command-returning controller is staged |
| Live gain editing | Team/vendor tooling today; a Bordeaux live-tuning surface is staged |

## Choose a task

- [Getting started](getting-started.md) walks from an existing GradleRIO project to a loaded export
  whose events invoke the robot's commands.
- [Connect existing commands](commands.md) explains when to expose a `Command`, a
  `Supplier<Command>`, or an annotated factory method without rewriting the team's teleop or auto.
- [Drivetrain and localization](drivetrain-and-localization.md) connects corrected pose, measured
  speeds, IMUs, Kalman/pose-estimator correction, vision, and any swerve module stack through one
  vendor-neutral seam.
- [Aquitaine and generated paths](aquitaine-and-generated-paths.md) covers commands, decisions,
  waits, static paths, contained robot-side generation, fallback, and safe-stop ownership.
- [Testing and tuning](testing-and-tuning.md) separates hardware control, localization, following,
  generation, deterministic simulation, and staged live-tuning work.
- [Troubleshooting](troubleshooting.md) diagnoses catalog, export, scheduling, drivetrain, vision,
  and generated-trajectory failures from the first rejected boundary.

## Examples and references

- The [complete template robot](../../examples/bordeaux-template-robot/README.md) is a runnable
  GradleRIO project with commands, conditions, generated bindings, export loading, lifecycle cleanup,
  and a bounded generated-path provider.
- The [Java example gallery](../../java/examples/README.md) adds compile-checked drivetrain,
  estimator, vision, IMU, generated-path, containment, and simulation examples, followed by
  verification-labeled vendor recipes.
- The [desktop/catalog contract](../java-commands.md) records the exact export workflow, schema
  versions, identity checks, and trust boundary.
- The [runtime reference](../../java/README.md) documents catalog identity, event and routine
  execution, generated-trajectory safety, drivetrain integration, and the optional push mailbox.

For a first integration, get one existing command into the built catalog and run it from an exported
event. Add drivetrain, vision, routines, and Aquitaine generation through the gallery after that
small path works end to end.
