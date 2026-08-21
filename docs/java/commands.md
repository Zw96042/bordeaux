# Connect existing WPILib commands

Most teams should not rewrite teleop or autonomous commands for Bordeaux. Annotate the command
factory they already trust, or expose it through a small provider that holds the team's existing
subsystems and factories.

The important choice is whether Bordeaux should reuse one `Command` object or create a new one for
each invocation.

## Choose the right exposure

| Existing API | Bordeaux exposure | Use it when |
| --- | --- | --- |
| One already-constructed command | `public final Command` field | The existing trigger/auto and Bordeaux are guaranteed to be mutually exclusive |
| A no-argument command factory | Annotated method or `public final Supplier<Command>` | Every invocation should receive a fresh command |
| A parameterized command factory | Annotated method with `@BordeauxParam` | Bordeaux should author typed arguments |
| A command already composed into a group | Expose the group's factory | Never expose the composed child instance independently |
| A chooser containing prebuilt commands | Expose the underlying auto factory | Independent Bordeaux runs need more than `chooser::getSelected` if it returns the same object |

Fields must be public and final. Factory methods must be public methods on a public provider type.
Returning a `Command` subtype is supported.

## Reusing one `Command` means one lifecycle

This form returns the exact same object to the existing robot code and to Bordeaux:

```java
@BordeauxCommand(id = "drive.align", label = "Align to target")
public final Command alignCommand;
```

WPILib does not create another run when that same object is scheduled again while it is already
scheduled. A cancellation from either entry point ends the same run. Its requirements, interruption
behavior, internal state, and composed-command restrictions are also shared.

That can be correct for a command which only runs in autonomous and where Bordeaux is the sole
autonomous owner. It is unsafe when a driver trigger and a Bordeaux event may overlap. It is
especially risky with **Cancel at path end**: ending the path cancels that shared object, even if
another entry point expected it to remain active.

Do not annotate a child command after it has been composed into a WPILib command group. WPILib owns
that instance through the group. Expose a factory for the group or construct a fresh equivalent
command instead.

## Use a supplier for independent invocations

A supplier lets the generated binding request a command for each invocation:

```java
@BordeauxCommand(id = "shooter.fire", label = "Fire")
public final Supplier<Command> fireCommand = shooter::fireCommand;
```

The supplier must actually return a fresh, non-null, uncomposed command each time. A method reference
does not guarantee freshness by itself: `chooser::getSelected` still returns a shared object when the
chooser stores one prebuilt command.

Fresh commands separate internal command state and path-end cancellation. They do not bypass WPILib
requirements; two fresh commands requiring the same subsystem still follow the commands' normal
interruption behavior.

Prefer a supplier when:

- teleop and Bordeaux can invoke the same action independently;
- an autonomous routine may repeat or restart the action;
- path-end cancellation must affect only the invocation created for that event; or
- the existing API already provides a command factory.

The supplier field itself is final so the generated binding cannot silently point at a different
factory after the catalog is compiled.

## Annotate an existing factory directly

An annotated method is usually the clearest option for a parameterized action:

```java
@BordeauxCommand(id = "intake.run", label = "Run intake")
public Command runIntake(
        @BordeauxParam(label = "Output", defaultValue = "0.65", min = "-1", max = "1")
        double output) {
    return intake.runCommand(output);
}
```

The generated binding validates authored arguments before calling the method. `defaultValue` is JSON
text, while `min` and `max` are exact decimal strings. Use short labels for operators and stable IDs
for the deployed contract. Labels affect the catalog hash even though they do not change runtime
behavior, so rebuild the catalog and re-export after changing any annotation or signature. Changing
an ID additionally breaks authored references until the project is updated.

If an existing command field must stay private, expose it with a small annotated public method. That
method still returns the same instance and therefore keeps the shared lifecycle described above. To
make it independent, expose the factory instead.

## Reuse the robot's real providers

Construct the provider with the same subsystem instances used by bindings, default commands, and the
autonomous chooser:

```java
private final Superstructure superstructure = new Superstructure();
private final RobotCommands actions = new RobotCommands(superstructure);
private final BordeauxCapabilities bordeaux =
        BordeauxBindings.generatedCapabilities(actions);
```

Pass every provider containing non-static annotated members. Provider order does not matter. Do not
construct Bordeaux-only subsystem copies; command requirements and state must refer to the robot's
real subsystem objects.

The concise, compile-checked patterns are in
[`ExistingCommandProvider`](../../java/examples/src/main/java/dev/bordeaux/examples/commands/ExistingCommandProvider.java).
The [template provider](../../examples/bordeaux-template-robot/src/main/java/frc/robot/commands/ExampleCommands.java)
adds conditions, enums, records, bounded numbers, and commands intended to demonstrate path-end
cancellation. For all accepted argument shapes and runtime guarantees, use the
[Java runtime reference](../../java/README.md).

After changing an annotation or signature, rebuild `bordeauxCatalog` and re-export. The catalog hash
exists specifically to prevent an older authored invocation from silently calling a changed robot
API.
