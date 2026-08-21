
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
