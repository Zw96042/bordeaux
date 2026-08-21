
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
