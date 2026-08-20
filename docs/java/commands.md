
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
