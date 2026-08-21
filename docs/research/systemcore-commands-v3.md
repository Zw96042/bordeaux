# Systemcore-era WPILib Commands v3

Research date: 2026-08-20

## Conclusion

“Commands v3 from Systemcore” is the official **WPILib Commands v3** Java framework for the 2027 Systemcore software stack, not a separate Systemcore or third-party project. Its released package is `org.wpilib.command3`; the primary command type is `org.wpilib.command3.Command`. ([WPILib repository identity](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/README.md#L1-L8), [v3 `Command`](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L5-L39))

Bordeaux should support it, but **not** by adding v3 imports to the current v2 runtime or trying to wrap a v2 command as a v3 command. The two frameworks have different command types, lifecycle models, requirement types, schedulers, and interruption rules. More decisively, WPILib's own vendordep metadata rejects projects that install both Commands v2 and Commands v3. ([v2 command contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv2/src/main/java/org/wpilib/command2/Command.java#L21-L84), [v3 command contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L97-L165), [vendordep conflict](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/CommandsV3.json#L9-L14))

The right product meaning of “v2 and v3 compatibility” is:

- one Bordeaux annotation, catalog, Aquitaine format, and user workflow;
- two native framework implementations, but three season/framework compatibility baselines built and tested separately;
- 2026 Commands v2 (`edu.wpi.first.wpilibj2`), 2027 Commands v2 (`org.wpilib.command2`), and 2027 Commands v3 (`org.wpilib.command3`) artifacts or build variants;
- no robot program or integration-test classpath containing both official vendordeps.

Commands v3 should remain **experimental** in Bordeaux until WPILib publishes a sufficiently stable 2027 release. The latest published version found is `2027.0.0-alpha-6`, explicitly marked a pre-release, and the official documentation still says Commands v3 documentation is in progress. The post-alpha source has already changed `Mechanism` from a class to an interface, changed scheduling/fork result APIs, and renamed the Maven artifact. ([alpha-6 release](https://github.com/wpilibsuite/allwpilib/releases/tag/v2027.0.0-alpha-6), [2027 changelog](https://docs.wpilib.org/en/latest/docs/yearly-overview/yearly-changelog.html#major-changes-java-c-python), [released `Mechanism`](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Mechanism.java#L12-L35), [current `Mechanism`](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/src/main/java/org/wpilib/command3/Mechanism.java#L12-L40), [current scheduling result](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L339-L451), [artifact rename](https://github.com/wpilibsuite/allwpilib/pull/9231))

## Verified release and distribution snapshot

This report describes public behavior from the latest published tag found, commit `878da3d54cbc6b64d663bded17d87d5bed040ed9` (`v2027.0.0-alpha-6`). References to `main` are called out separately and are evidence of API churn, not a second compatibility target.

| Property | Verified value |
| --- | --- |
| Owner/project | `wpilibsuite/allwpilib`, `commandsv3` subproject |
| Season/status | WPILib `2027.0.0-alpha-6`, pre-release |
| Language | Java only; the build sets `useCpp = false`, and the vendordep contains no C++ or JNI dependencies. ([build metadata](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/build.gradle#L1-L28), [vendordep dependencies](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/CommandsV3.json#L16-L24)) |
| Java level | Java 25. ([WPILib build target](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/build.gradle#L125-L129), [2027 changelog](https://docs.wpilib.org/en/latest/docs/yearly-overview/yearly-changelog.html#major-changes-java-c-python)) |
| Released Java coordinate | `org.wpilib:commands3-java:2027.0.0-alpha-6`. ([official alpha-6 POM](https://frcmaven.wpi.edu/artifactory/wpilib-mvn-release-2027-local/org/wpilib/commands3-java/2027.0.0-alpha-6/commands3-java-2027.0.0-alpha-6.pom)) |
| Vendordep | `CommandsV3.json`; its template version is `1.0.0`, season is still labeled `2027_alpha5`, and dependency version is the WPILib placeholder. Those fields are not evidence of API stability. ([released vendordep](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/CommandsV3.json#L1-L24)) |
| Direct library dependencies | WPILibJ, HAL, WPIMath, NTCore, WPIUtil/WPINet, WPI annotations, and Quickbuf. ([build dependencies](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/build.gradle#L13-L33)) |
| License | BSD 3-Clause, the standard WPILib license. ([project statement](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/README.md#L27-L29), [license text](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/LICENSE.md#L1-L24)) |

The framework uses reflective access to JDK-internal continuation classes. WPILib's test build opens `java.base/jdk.internal.vm` and `java.base/java.lang`, and GradleRIO adds the corresponding runtime options for Systemcore deployment and simulation. Bordeaux should rely on GradleRIO's season integration in robot projects and reproduce the module opens in any standalone v3 test harness. ([commands v3 test configuration](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/build.gradle#L38-L50), [GradleRIO Systemcore deployment](https://github.com/wpilibsuite/GradleRIO/blob/46bf487150b3f66ca1ef10c11445c4ca2d8235b4/src/main/java/org/wpilib/gradlerio/deploy/systemcore/WPILibJavaArtifact.java#L33-L43), [GradleRIO simulation](https://github.com/wpilibsuite/GradleRIO/blob/46bf487150b3f66ca1ef10c11445c4ca2d8235b4/src/main/java/org/wpilib/gradlerio/wpi/java/WPIJavaExtension.java#L117-L129))

Commands v3 is not the only official 2027 choice. Alpha-6 also publishes a Systemcore-capable Commands v2 vendordep using `org.wpilib.commandsv2:commandsv2-java`, and the official project importer defaults projects without an explicit selection to v2. Full Systemcore support therefore requires a 2027-v2 baseline in addition to the v3 work described here. ([2027 Commands v2 vendordep](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv2/CommandsV2.json#L1-L45), [official importer selection](https://github.com/wpilibsuite/vscode-wpilib/blob/5c38b3320ce2f0d6f78e974c1f7f621da2148224/vscode-wpilib/src/webviews/gradle2025import.ts#L271-L291))

## Implemented command model in alpha-6

### Lifecycle and construction

A v3 `Command` is an interface with one coroutine-backed `run(Coroutine)` body, an optional `onCancel()` cleanup hook, a mandatory `name()`, a set of `Mechanism` requirements, and an integer priority. A periodic command writes ordinary control flow and must call `Coroutine.yield()` inside every loop; an unbounded loop that does not yield stalls the robot program. ([command lifecycle](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L17-L47), [public contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L97-L165))

Staged builders make requirements, implementation, and name compile-time construction stages. Builders also provide cancellation cleanup, priority, and end conditions. WPILib's compiler plugin checks several unsafe coroutine patterns, including loops without a yield, code after `park()`, and incorrect coroutine capture/use. These checks improve diagnostics but do not turn the scheduler into a preemptive runtime. ([staged builder contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/StagedCommandBuilder.java#L18-L54), [builder options](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/StagedCommandBuilder.java#L123-L169), [compiler checks](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/javacPlugin/src/main/java/org/wpilib/javacplugin/WPILibJavacPlugin.java#L20-L35), [cooperative non-goal](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/design-docs/commands-v3.md#L235-L249))

The scheduler creates a new coroutine for each accepted schedule of a command object. The same object cannot be scheduled again while queued or running, but it can be scheduled again after completion or cancellation. ([schedule duplicate/result handling](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L305-L408), [fresh coroutine construction](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L856-L895))

### Scheduler, scheduling results, and interruption

User code calls `Scheduler.getDefault().run()` periodically. Scheduling and cancellation must happen on the same non-virtual thread as `run()`; WPILib warns that violating this rule can produce incorrect behavior or JVM crashes. Bordeaux must therefore call the team's selected scheduler directly from the normal robot loop and must not create a worker thread around a v3 command. ([scheduler loop and thread contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L33-L64))

In alpha-6, `schedule(Command)` returns `SUCCESS`, `ALREADY_RUNNING`, or `LOWER_PRIORITY_THAN_RUNNING_COMMAND`. A child scheduled from within a running command starts immediately rather than waiting for another scheduler loop. An external `cancel(Command)` is immediate, invokes `onCancel()` only if the command had started running, and recursively cancels descendants; a currently mounted command is not allowed to cancel itself through this method and gets an `IllegalArgumentException`. `cancelAll()` handles all queued and running commands. ([schedule result and child start](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L305-L408), [cancellation](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L511-L544), [`cancelAll`](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L921-L940))

An uncaught runtime exception emits a completion-with-error event, removes the failed command, cancels its descendants and enclosing command tree, and is rethrown. The failed command itself does not receive `onCancel()` on this path. Bordeaux should preserve this failure rather than reporting the routine step as a normal cancellation or completion. ([exception path](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L724-L765))

### Requirements, priorities, and ownership

`Mechanism` is v3's exclusivity resource. A running command exclusively owns its declared mechanisms. A conflicting incoming command of equal or higher priority interrupts the running command; a lower-priority command is rejected. Default commands are scoped settings, and the released scheduler requires a default command to require exactly the one mechanism it defaults. ([requirement and priority semantics](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L41-L57), [default command validation/scoping](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L183-L238), [released `Mechanism` factories](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Mechanism.java#L70-L159))

Built-in sequence and parallel groups aggregate all child requirements for the group's entire lifetime and use the maximum child priority. Parallel construction rejects children with overlapping mechanisms. In contrast, direct coroutine `fork`/`await` composition lets a parent have no requirement of its own while child commands acquire mechanisms only while they run. No child command may outlive its parent. ([sequence ownership](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/SequentialGroup.java#L14-L74), [parallel ownership](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/ParallelGroup.java#L14-L100), [coroutine child lifetime](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Coroutine.java#L70-L165), [orphan cleanup](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L842-L865))

This distinction matters for Aquitaine, but it must not silently change Aquitaine semantics. Current command nodes schedule a command and immediately continue; stopping or completing the routine does not make those commands routine-owned. If Bordeaux schedules such a node from inside a short-lived v3 wrapper command, v3 would instead make it a child and cancel it when that wrapper exits. The initial adapter must preserve the current fire-and-continue behavior at its documented call-site scope. A future explicit “await” or “owned command” node could deliberately use native child lifetime. Bordeaux must never invoke a child's `run(Coroutine)` method itself, because that would bypass scheduling, requirement arbitration, and telemetry. ([current routine command behavior](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxRoutineRunner.java))

### Composition, triggers, state machines, and telemetry

The released API includes static factories for no-requirement and requirement-bearing commands, waits, sequences, parallel groups, and races, plus instance decorators such as timeout, `until`, `andThen`, `alongWith`, and `raceWith`. ([factories and decorators](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L206-L417))

`Trigger` supports rising/falling scheduling, while-active cancellation, toggles, logical composition, debounce, and single-cycle edge triggers. Bindings created inside a command exist only for that command's lifetime; bindings and commands are canceled when their command or opmode scope ends. ([trigger bindings](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Trigger.java#L19-L42), [binding operations](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Trigger.java#L115-L191), [logical and edge operations](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Trigger.java#L193-L291), [scope cleanup](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Trigger.java#L410-L462))

Alpha-6 also has a declarative `StateMachine`. Each state runs a child command, conditional transitions cancel the current state's command, and a compile-time initializer check requires an initial state. The state machine itself declares no fixed mechanisms because active state commands acquire them dynamically. ([state-machine model](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/StateMachine.java#L17-L99), [initial-state and transition execution](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/StateMachine.java#L135-L207))

Scheduler telemetry has a protobuf snapshot for queued/running commands and timing, plus immediate lifecycle events. A one-shot command can start and finish within one `run()` call and be absent from the snapshot, so Bordeaux completion/diagnostic integration should use scheduler events or explicit scheduler state rather than snapshots alone. ([telemetry behavior](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L86-L100), [event listener contract](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L1046-L1104))

### Disabled behavior: unresolved and unsafe to infer

Alpha-6 does not expose a v2-style `Command.runsWhenDisabled()` method. Its scheduler `run()` implementation processes scopes, triggers, defaults, queued commands, and running commands without an explicit Driver Station enabled/disabled gate. The official Hatchbot v3 example runs the scheduler from `robotPeriodic()` in every mode and leaves its disabled hooks empty. ([v3 command surface](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L97-L165), [scheduler cycle](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L546-L595), [Hatchbot mode handling](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/wpilibjExamples/src/main/java/org/wpilib/examples/hatchbotcmdv3/Robot.java#L40-L61))

Opmode scope is not an implicit enable-safety mechanism. A v3 opmode scope stays active while the selected opmode ID is unchanged, and WPILib explicitly documents that an opmode can remain selected while the robot is disabled. Entering disabled therefore does not inherently stale or cancel an opmode-scoped v3 command. ([opmode scope implementation](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/BindingScope.java#L20-L74), [opmode selection versus enabled state](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/wpilibj/src/main/java/org/wpilib/driverstation/RobotState.java#L205-L215))

There is one contradictory released Javadoc sentence claiming a sequence may run while disabled if all children can, but the released `Command` interface has no corresponding capability method. ([contradictory sequence Javadoc](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/SequentialGroup.java#L14-L23)) This appears stale or incomplete; no supported alpha-6 policy should be inferred from it.

Bordeaux therefore needs an explicit, backend-neutral enabled/safe-stop policy at its own motion boundary. On robot disable, the integration should reject new Bordeaux-owned scheduling, cancel all still-running work Bordeaux started, and command zero/idle drivetrain output until WPILib publishes a clear replacement contract. On ordinary path/runner stop, it should cancel only event commands the file explicitly marks with `cancelOnPathEnd`; fire-and-continue routine commands retain their documented lifetime unless the file format adds an ownership rule. This is a Bordeaux safety recommendation based on the source inconsistency, not a claim about future WPILib behavior.

### Unit testing and simulation

The scheduler can create an independent instance specifically for test isolation. WPILib's own tests combine it with an injected robot clock, and timing tests advance that clock deterministically. `Scheduler.addPeriodic()` also explicitly lists simulation updates as an appropriate callback use. ([independent scheduler](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L150-L178), [test fixture](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/test/java/org/wpilib/command3/CommandTestBase.java#L13-L40), [deterministic timing test](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/test/java/org/wpilib/command3/SchedulerTimingTests.java#L151-L202), [periodic/simulation callback](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L260-L303))

No separate Commands-v3-specific hardware simulation API was found. Robot simulation remains a WPILib/hardware concern; Bordeaux's command adapter tests should use an independent scheduler, fake mechanisms and outputs, a fake clock, and its existing deterministic drivetrain seams.

## Commands v2 versus v3

| Concern | Commands v2 in 2027 | Commands v3 alpha-6 | Bordeaux consequence |
| --- | --- | --- | --- |
| Type | `org.wpilib.command2.Command`, abstract class and `Sendable` | `org.wpilib.command3.Command`, interface | Return-type recognition and generated binding code need backend-specific types. ([v2 type](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv2/src/main/java/org/wpilib/command2/Command.java#L21-L40), [v3 type](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L97-L125)) |
| Lifecycle | `initialize`, repeated `execute`, `isFinished`, `end(interrupted)` | one `run(Coroutine)` body plus `onCancel` | A v2 instance cannot be delegated to the v3 scheduler or mechanically cast/wrapped. ([v2 lifecycle](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv2/src/main/java/org/wpilib/command2/Command.java#L43-L68), [v3 lifecycle](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L114-L134)) |
| Resource | `Subsystem` | `Mechanism` | Backend adapters cannot share a native requirement object. |
| Interruption | Binary `InterruptionBehavior` | Integer priorities; lower-priority scheduling may fail | Bordeaux needs a structured scheduling outcome and must not assume every request was accepted. ([v2 interruption/disabled hooks](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv2/src/main/java/org/wpilib/command2/Command.java#L548-L566), [v3 priority](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Command.java#L154-L165)) |
| Scheduler | `CommandScheduler` | `Scheduler`; explicit schedule result and strict same-thread rule | Inject the correct native scheduler; do not emulate it or run a second one. |
| Composition | Decorator/group ownership tracked by v2 scheduler | staged builders, groups, and coroutine `fork`/`await`; children are scheduler-visible and parent-scoped | Only a future explicitly awaited/owned Aquitaine node should use child ownership; existing nodes remain fire-and-continue. |
| Triggers/scopes | Global command-based trigger model | global, opmode, and command scopes with automatic cleanup | Tests must cover which scope a Bordeaux event is scheduled from. |
| Disabled | `runsWhenDisabled()`, false by default | no coherent released equivalent verified | Bordeaux must enforce its own safe boundary for now. |
| Language | Java and C++ framework | Java only | Do not advertise a C++ v3 Bordeaux backend. |

WPILib's official importer does not migrate command implementations from v2 to v3. It preserves an existing v3 selection, preserves v2/legacy projects, and defaults an unspecified command framework to v2; generated examples similarly select one command version. ([import behavior](https://github.com/wpilibsuite/vscode-wpilib/blob/5c38b3320ce2f0d6f78e974c1f7f621da2148224/vscode-wpilib/src/webviews/gradle2025import.ts#L271-L291), [example selection](https://github.com/wpilibsuite/vscode-wpilib/blob/5c38b3320ce2f0d6f78e974c1f7f621da2148224/vscode-wpilib/src/shared/examples.ts#L36-L45)) No official v2-to-v3 migration guide was found; the official 2027 docs instead point to a design document and the Hatchbot port while documentation is unfinished. ([official documentation status and examples](https://docs.wpilib.org/en/latest/docs/yearly-overview/yearly-changelog.html#major-changes-java-c-python))

For teams, migration therefore means porting their robot commands to v3. The safest path is two-stage: first import and verify the robot on 2027 Commands v2, then opt into v3 on a dedicated branch and port the native commands. The official vendordep conflict prevents an incremental mixed-v2/v3 robot project, so Bordeaux must reject a mixed-framework catalog rather than pretending individual commands can cross the boundary. Bordeaux's promise should be that, once a command already has the correct native type, adding `@BordeauxCommand` remains the only Bordeaux-specific step. Bordeaux should not promise to translate an arbitrary v2 command object into v3.

## Current Bordeaux gap

The current Java library is v2-specific in at least five independent places:

1. The annotation processor hardcodes the 2026 `edu.wpi.first.wpilibj2.command.Command` as the only valid return/field/supplier type, so it accepts neither 2027 v2 nor v3. ([processor](../../java/processor/src/main/java/dev/bordeaux/processor/BordeauxProcessor.java))
2. `BordeauxCommandRegistry` stores factories returning that v2 type. ([command registry](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxCommandRegistry.java))
3. `BordeauxEventRunner` and `BordeauxRoutineRunner` schedule and retain v2 command instances, with the default adapter calling `CommandScheduler.getInstance()`. ([event runner](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxEventRunner.java), [routine runner](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxRoutineRunner.java))
4. The project compiles at Java 17 against WPILib 2026.2.2 v2 artifacts, whereas released v3 is a Java 25/2027 artifact. ([Java build](../../java/build.gradle.kts), [runtime dependencies](../../java/runtime/build.gradle.kts))
5. `BordeauxDrive.requirement()` and `BordeauxDriveAdapter.forSubsystem(...)` expose the v2 `Subsystem` type even though current production motion code does not consume that requirement. This type must move out of the common drive seam or into a v2-specific follower/command adapter. ([drive contract](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDrive.java), [drive adapter](../../java/runtime/src/main/java/dev/bordeaux/runtime/BordeauxDriveAdapter.java))

Changing only the processor's accepted FQN would produce generated code that the runtime cannot store or schedule. Changing only the runtime dependency would drop 2026 compatibility. The separation has to occur at the command execution boundary.

There is also a broader 2027 season boundary: WPILib is moving Java packages from `edu.wpi.first` to `org.wpilib`, while Bordeaux's public drive, pose, and trajectory APIs currently expose 2026 `edu.wpi.first.math` types. Commands v3 work is therefore necessary but not sufficient for full Systemcore support. The 2027 build must recompile or adapt the remaining WPILib-facing runtime against the 2027 packages; one binary should not be assumed to span both seasons without a real compatibility build. ([official package reorganization](https://docs.wpilib.org/en/latest/docs/yearly-overview/yearly-changelog.html#major-changes-java-c-python), [current runtime dependencies](../../java/runtime/build.gradle.kts))

## Recommended Bordeaux architecture

### Stable common surface

Keep these independent of WPILib command generation:

- `@BordeauxCommand`, its IDs, labels, parameters, aliases, and catalog schema;
- Aquitaine command nodes, event timing, conditions, waits, decisions, and generated-trajectory contracts;
- preflight validation and catalog ID/hash checks;
- drivetrain, vision, tuning, and trajectory data contracts.

Add a small internal command-backend seam with only the behavior Bordeaux actually needs: create one invocation, request scheduling, distinguish accepted, already-active, and rejected outcomes, and request cancellation only when a fresh provider or future run-token mechanism makes ownership of that run provable. Do not expose v2 `Subsystem`, v3 `Mechanism`, `Coroutine`, or either scheduler through the common API.

The invocation must retain the exact native command instance it schedules. A supplier/factory that returns a genuinely fresh command is required for reliable `cancelOnPathEnd` unless a future backend can prove run-token ownership. Annotated final command fields remain useful for fire-and-continue behavior under a team-enforced exclusive-ownership rule, but native schedulers cancel by object rather than Bordeaux run token. Retaining a reused field cannot prevent that object from completing and later being restarted by another owner before path end. Routine command nodes remain fire-and-continue unless their file contract is deliberately extended later.

A shared annotated command field is not an independent invocation source: a second schedule while it is active returns `ALREADY_RUNNING`. That outcome must **not** transfer `cancelOnPathEnd` ownership to the second Bordeaux event, or path end could cancel a preexisting run started by a trigger or another routine. Even `ACCEPTED` is insufficient for delayed cancellation of a reusable field: the accepted run can finish, then another owner can restart the same object before path end. `ACCEPTED` does not necessarily mean the command has mounted yet; an external request normally queues until `Scheduler.run()`, while a child may start immediately and even complete before `schedule()` returns. Documentation should require fresh factory methods or suppliers whenever separate events need independently owned lifetimes; retained fields remain convenient for deliberately shared fire-and-continue commands. ([alpha-6 schedule flow](https://github.com/wpilibsuite/allwpilib/blob/878da3d54cbc6b64d663bded17d87d5bed040ed9/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L349-L408))

### Separate native adapters

Publish or otherwise build three exclusive compatibility variants from shared source/logic where practical:

- a 2026 Commands v2 adapter compiled against the supported Java 17 WPILib coordinate and `edu.wpi.first.wpilibj2.command.Command`;
- a 2027 Commands v2 adapter compiled with Java 25 against `org.wpilib.command2.Command`;
- a 2027 Commands v3 adapter compiled with Java 25 against `org.wpilib.command3.Command` from one pinned 2027 release.

Because the 2027 package reorganization extends beyond commands, both 2027 adapters must be delivered with a 2027-compatible Bordeaux runtime variant. The command-backend seam should not be mistaken for proof that the existing 2026 runtime JAR can load unchanged on the 2027 stack.

The annotation processor can share catalog/schema logic, but backend-specific compile tests must resolve only the appropriate native FQN. Generated Java bindings and `.bordeaux/install.json` must identify the selected backend and fail clearly if a project mixes native command frameworks. Backend identity and provider-kind/cancellation eligibility must stay out of authored JSON, `META-INF/bordeaux/commands.json`, and `catalogHash`; supplier freshness remains an author contract because it cannot be proven statically. The robot-facing setup should stay simple: installing the matching Bordeaux vendordep/dependency should select the backend, and the existing annotation remains unchanged.

The v3 adapter should:

- accept an injected `org.wpilib.command3.Scheduler`, defaulting explicitly to `Scheduler.getDefault()` only in the convenience constructor;
- call `schedule()` and translate every native result into a Bordeaux outcome instead of assuming success;
- acquire delayed Bordeaux cancellation ownership only for a fresh supplier/factory invocation whose schedule is accepted, then call `cancel()` on that exact instance;
- never call a command's `run(Coroutine)` itself and never create a scheduler thread;
- preserve and document the native scope active at the schedule call site rather than simulating parent-child ownership;
- let native scheduler exceptions propagate and report every attempt through an injected runtime status sink containing the event/node ID, command ID, and normalized result;
- reject new Bordeaux-owned work while disabled, cancel all Bordeaux-owned work and safe-stop motion on robot disable, and cancel only explicit `cancelOnPathEnd` ownership on ordinary path/runner stop until WPILib's policy is documented and implemented coherently.

For Aquitaine, keep the existing caller-driven runner first and document that schedules use the scope active at the call site. Do not add a native v3 routine-command wrapper until its lifetime rules are explicit: wrapping a fire-and-continue node as a child would make it die with the wrapper. If Bordeaux later adds an awaited/owned command-node kind, that new kind can deliberately use v3 parent-child cancellation.

To preserve current event and routine behavior, a rejected v3 schedule should be attempted exactly once, recorded for diagnostics, and not automatically retried or stop the path. `ACCEPTED`, `ALREADY_ACTIVE`, and lower-priority rejection should be distinct Bordeaux outcomes. Do not collapse the first two into a generic “successful” result: current WPILib `main` classifies `AlreadyRunning` as successful even though it did not create a new binding or ownership relationship. A future routine policy may elect to fail on rejection, but that is a product/file-contract decision rather than an adapter default. ([current result hierarchy](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L339-L451))

## Delivery plan

### Phase 0 — define and protect the boundary

1. Add framework identity/version to generated Java binding and install metadata without changing authored catalog or Aquitaine files.
2. Define the backend-neutral invocation and scheduling-result contract.
3. Decouple the Java support ABI from the exact catalog-schema pairing so a new registry ABI can remain compatible with an unchanged schema shape; track this in [#155](https://thelab.wilsonzach.com/project/bordeaux/issue/155).
4. Remove or relocate the unused v2 `Subsystem` requirement from the common drivetrain seam.
5. Add regression tests around current v2 create/schedule/cancel/ownership and routine fire-and-continue behavior before moving it behind the seam.
6. Keep all public behavior unchanged for the existing 2026 build.

Exit criterion: no common registry or runner API needs a WPILib command type, while the v2 adapter passes the existing suite unchanged.

### Phase 1 — 2027 runtime and Commands v2 baseline

1. Create a separate Java 25/WPILib 2027 build fixture pinned to an explicit released tag.
2. Port or adapt Bordeaux's remaining WPILib-facing pose, kinematics, drivetrain, and runtime types to the 2027 `org.wpilib` packages.
3. Accept 2027 `org.wpilib.command2.Command` methods, fields, and suppliers through a season-correct v2 adapter.
4. Prove the official default Systemcore command option works before making v3 a requirement for Bordeaux users.

Exit criterion: a 2027 Commands v2-only Systemcore fixture builds and exercises Bordeaux without 2026 classes or the v3 vendordep present.

### Phase 2 — experimental Commands v3 adapter

1. Accept annotated v3 factory methods, command fields, and `Supplier<? extends Command>` fields with the same Bordeaux annotation and catalog output as both v2 variants.
2. Implement schedule-result translation, fresh-provider cancellation eligibility, structured rejection diagnostics, exception propagation, and injected-scheduler support.
3. Add a minimal existing-command example: one teleop command, one autonomous command, a trigger-bound command, and one Aquitaine command node. The example should demonstrate that existing native commands only gain an annotation; it should not rewrite them into Bordeaux-specific base classes.
4. Keep Commands v3 labeled experimental and pinned to the exact upstream tag used by the fixture.

Exit criterion: a Commands v3-only robot fixture compiles and exercises the full command path without either Commands v2 vendordep or v2 classes present.

### Phase 3 — composition, routine, safety, and tooling parity

Test at minimum:

- accepted, already-running, and lower-priority-rejected schedules;
- an already-running shared field followed by `cancelOnPathEnd`, proving the preexisting run is not canceled;
- a reusable field that completes and is restarted by another owner before path end, proving Bordeaux does not cancel the later run;
- equal/higher-priority interruption and exact `onCancel()` count;
- one-shot completion within a single scheduler cycle;
- repeated runs of a command field and fresh commands from factories/suppliers;
- child start in the same loop and child cancellation with its native parent;
- event `cancelOnPathEnd` cancellation and routine fire-and-continue behavior across routine completion, stop, and reset;
- command-, opmode-, and global-scope behavior;
- disabled transition, emergency stop, and zero/idle drivetrain output;
- uncaught command exception propagation and schedule-rejection diagnostics;
- deterministic waits with an independent scheduler and fake clock;
- module-open configuration in unit tests and simulation.

Add a compile matrix rather than one combined test project:

- Java 17 + WPILib 2026 + Commands v2;
- Java 25 + the pinned WPILib 2027 release + Commands v2;
- Java 25 + the pinned WPILib 2027 release + Commands v3;
- optionally, a non-blocking current-`main` probe to warn about upcoming API changes.

Exit criterion: v3 matches Bordeaux's v2 product workflow and safety/ownership guarantees, even where native scheduler mechanics differ.

### Phase 4 — stable support gate

Do not label Commands v3 “supported” until all of these are true:

- WPILib has published the target beta/stable artifact and vendordep coordinate;
- the `Mechanism`, scheduler result, coroutine composition, and disabled-mode contracts are re-audited against that tag;
- key ecosystem libraries used by Bordeaux examples publish compatible 2027 artifacts;
- Bordeaux's Java 25 integration suite and examples pass against that exact release;
- migration and troubleshooting documentation names the supported WPILib versions and the no-v2/v3-coexistence rule.

## Main risks and open questions

- **API churn is active.** Since alpha-6, `Mechanism` became an interface specifically to permit inheritance patterns such as CTRE swerve, the artifact changed from `commands3-java` to `commandsv3-java`, and the schedule result changed from an enum to a sealed result hierarchy. ([interface/CTRE motivation](https://github.com/wpilibsuite/allwpilib/pull/8303), [current artifact](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/CommandsV3.json#L16-L21), [current scheduling API](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/src/main/java/org/wpilib/command3/Scheduler.java#L339-L451)) An adapter written only to alpha-6 is unlikely to compile unchanged against the next release.
- **A released composition failure was fixed only after alpha-6.** In alpha-6, a child that lost a priority conflict could silently fail during `fork`/`await`; the merged correction added explicit fork failure handling and default parent cancellation. ([official issue](https://github.com/wpilibsuite/allwpilib/issues/9205), [merged fix](https://github.com/wpilibsuite/allwpilib/pull/9207), [current fork result](https://github.com/wpilibsuite/allwpilib/blob/d2e21fafca6d2cbebfef6455743add253af306ee/commandsv3/src/main/java/org/wpilib/command3/Coroutine.java#L145-L230)) Bordeaux should not build production routine guarantees on alpha-6's behavior.
- **Disabled semantics are unresolved.** The released interface and scheduler do not implement the one sentence present in sequence Javadoc. Re-audit this before each supported release.
- **The runtime is strictly single-threaded and relies on internal JDK machinery.** A Bordeaux background executor must never touch the v3 scheduler or commands.
- **Vendor compatibility is release-specific.** Making `Mechanism` an interface improves integration with vendor drivetrain base classes, but does not prove that every 2027 vendor library has adopted Commands v3. Examples need compile verification per vendor artifact.
- **Commands are not the only 2027 source boundary.** WPILib's package reorganization also affects Bordeaux's public math, kinematics, and drivetrain types. A dual-season build must verify or adapt those APIs rather than assuming 2026/2027 binary compatibility.
- **Migration is source work.** Bordeaux can preserve catalog and authoring data, but teams still need to port v2 command implementations and requirement types to v3.

The immediate recommendation is therefore to make Bordeaux's command boundary backend-neutral now, keep the existing v2 experience stable, and develop v3 behind an explicit experimental artifact and version pin. That gets Bordeaux ready for Systemcore without coupling the library's core data model to an unfinished alpha API.
