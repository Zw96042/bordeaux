# PathPlanner benchmark adapter

This headless adapter pins PathPlannerLib `2026.1.2`, WPILib `2026.1.1`, Java 17, and the Gradle invocation recorded by `pathPlannerAdapter.ts`. It resolves the official Maven artifacts at build time and does not copy PathPlanner into Bordeaux.

The fixed-geometry mapping passes only authored positions, headings, constraints, endpoint velocities, and a frozen swerve dynamics configuration to PathPlannerLib. Bordeaux timing is never supplied. The adapter maps the authored centripetal limit to wheel friction and rejects waits, asymmetric acceleration/deceleration, and active jerk limits rather than silently dropping them.

PathPlanner's GUI-only genetic geometry optimizer has no reproducible headless API in v2026.1.2, so corridor fixtures produce an explicit unsupported outcome. This is a benchmark limitation, not product compatibility or migration support.

Run the real fixed-geometry integration with:

```sh
JAVA_HOME=/path/to/jdk-17 npm run test:benchmark:pathplanner
```

The integration writes a canonical request to a temporary directory, invokes the Java harness, retains its raw JSON bytes and process streams, normalizes only after capture, and submits the result to the neutral fixed-geometry validator.
