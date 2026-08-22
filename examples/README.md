# Bordeaux examples

Use the [Java integration guide](../docs/java/index.md) to choose an onboarding path, then copy the
smallest example that matches the robot's existing code:

- [`bordeaux-template-robot`](bordeaux-template-robot) is a complete GradleRIO project that can be
  linked to Bordeaux immediately. It demonstrates method, field, and supplier commands; conditions;
  events; generated bindings; trajectory loading; and a processor-checked Aquitaine generator provider.
- The [`Java example gallery`](../java/examples/README.md) contains compile-checked vendor-neutral
  examples plus clearly verification-labeled hardware recipes for CTRE Phoenix 6, YAGSL, REV
  MAXSwerve, PhotonVision, Limelight, QuestNav, PathPlanner, Choreo, and more.

The full robot template intentionally has no vendor drivetrain dependency. Select the gallery recipe
that matches the robot's existing subsystem and keep motor/module construction in that robot project.
