# LabVIEW Bordeaux fixture notes

## `2CycleDepotPart1.bdx`

The user supplied a real rebuilt-LabVIEW export on 2026-08-04. It is intentionally not copied into the repository because its command record embeds a workstation path and a serialized LabVIEW Variant/type descriptor.

- SHA-256: `5ee07b8aa234f9ec19613245af25ee38fd9ff1b701f2e7b745b4d79dab7ee64f`
- Size: 8,153 bytes
- Version: `4.4`
- Command count: `1` (`Intake Immediate.vi`)
- Path type: clothoid
- Drive type: holonomic

The fixture confirms the raw big-endian framing and the existing v4.4 top-level field order. Its command-free prefix and tail decode to:

- a populated `Linear 0` / Accel Straight segment with 43 position and velocity samples;
- an empty terminal Accel Straight trajectory cluster;
- 20 ms sample period;
- 14 fps, 30 fps², 2,000 fps³, and 14 fps StoopidFast limits;
- 0 fps authored initial velocity and 14 fps authored final velocity;
- 6 deg/s, 360 deg/s², and 1,000 deg/s³ angular limits;
- two updated waypoints;
- 0.82 s and 8.344701767010498 ft summary values;
- Current Limit 70 with the remaining top-level booleans false.

The populated segment also proves these writer conventions:

- a straight clothoid section is labeled `Linear 0` with Segment Type 0, not Blend;
- a no-deceleration profile stores the deceleration index as the sample-array length;
- endpoint-condition velocities are the authored values, not necessarily the last sampled value;
- the velocity-vector cluster remains `y` then `x`, and its Y component uses the opposite sign from increasing path-position Y.

After applying those conventions, a locally generated command-free equivalent is also 2,645 bytes, matching the size of the fixture with its command payload removed. The version/header, trajectory framing, conditions framing, and final flag bytes align. The files are not byte-identical: 1,362 bytes still differ, primarily in sampled positions, velocities, and summary time. The real file reports 0.82 s while its trajectory arrays contain 43 samples at 20 ms; it also begins at 0.6 fps and extends its final trajectory position beyond the updated endpoint. Those behaviors belong to the still-unrecovered LabVIEW timing/integration details and must not be copied as one-off constants.

The strict reader must still reject this original file because nonempty command records contain LabVIEW Variant and Path values. The observed command payload boundary is specific to this one artifact and must not be generalized into a skip algorithm.

## Remaining golden coverage

This fixture improves structural confidence but does not prove byte-identical trajectory math. It contains only a straight clothoid path and a command. Useful future LabVIEW-generated fixtures are:

1. command-free straight and curved clothoid paths;
2. a command-free multi-waypoint quintic Bezier path;
3. left/right turns, a turn beyond 90 degrees, and overlapping blends;
4. interior stop/wait and nonzero endpoint-velocity cases;
5. nondefault top-level flags and per-waypoint overrides.

Each fixture should be retained unchanged with its SHA-256, exact rebuilt Bordeaux revision, authoring inputs, and expected visible values.
