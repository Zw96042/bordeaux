# Choreo benchmark adapter

This adapter pins the official Choreo `2026.0.3` Linux x86_64 standalone CLI (`sha256:25a7392dceddb3b4110499e65c0955a331244548c7b0311fdcd981713bd39120`) from the official release archive (`sha256:e70d421d067ed3faeaeae4ad537ab7e82eabce98354e694820b612190ab1de4b`). Choreo pins Sleipnir `0.5.1` internally, so Sleipnir is recorded as solver provenance rather than a separate competitor. Bordeaux does not redistribute either binary.

The fixed-geometry mapping fixes dense Bordeaux-authored positions and headings but supplies no Bordeaux timing. The corridor mapping uses the Bordeaux-authored centerline only to create native `KeepInLane` boundaries and gate constraints; internal positions and headings remain solver-controlled. Both mappings use native zero-velocity endpoint, velocity, acceleration, and angular-velocity constraints plus a frozen swerve dynamics configuration. Choreo has no explicit authored angular-acceleration constraint, so that omission is recorded and the neutral validator rejects any violating result. Nonzero endpoint velocity, interior stops or waits, asymmetric acceleration, jerk, and Bordeaux range constraints are rejected instead of silently weakened.

Download and extract the official release, verify both recorded SHA-256 values, then run:

```sh
BORDEAUX_CHOREO_CLI=/absolute/path/to/choreo-cli npm run test:benchmark:choreo
```

The integration checks the binary digest and reported version before generating one fixed-geometry and one corridor fixture. It retains the exact generated `.traj` bytes and process streams, compacts Choreo's sub-5 ms rounded transition points, resamples the remaining variable solver intervals onto exact 20 ms cubic-Hermite ticks using Choreo's own poses and velocities, and preserves the exact final time before shared neutral validation.
