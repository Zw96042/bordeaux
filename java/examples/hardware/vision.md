the robot loop. Track each empty result as a rejected observation with its source-specific reason.

Use stable source IDs such as `photon-front`, `photon-rear`, `limelight-left`, and `questnav`. Keep
per-source health, last timestamp, accepted count, and rejection reason. Reject duplicate or
non-increasing timestamps per source before fusion; one disconnected camera should not stop the
drivetrain.

## Custom coprocessor or NetworkTables pose

Any system is compatible if it publishes:

- a finite blue-origin `Pose2d`;
- an FPGA capture timestamp, or enough documented latency to derive it from FPGA receipt time;
- positive X/Y/heading standard deviations; and
- a frame identity so a robot loop can drain each result exactly once.

If a protocol only publishes “latest pose” with neither frame identity nor capture timing, fix that
protocol before calling it pose-estimator input. The compile-checked latency factory is a convenience,
not permission to guess network or processing delay.

## Bring-up order

1. Verify odometry alone and log the corrected pose.
2. Log vision without fusing it; confirm axes, blue origin, capture time, and field bounds.
3. Establish distance/tag-count covariance from recorded data.
4. Fuse one source with conservative uncertainty and outlier rejection.
5. Add sources one at a time, then test delayed frames, disconnection, duplicate frames, and rotation.

Pose correction cannot rescue wrong module offsets, a reversed gyro, an alliance-origin mismatch, or a
timestamp in the wrong epoch.
