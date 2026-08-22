# Vision and pose correction

Every vision source ends at the same record:

```java
new BordeauxVisionObservation(
    sourceId, fieldPose, captureTimestampS,
    xStdDevM, yStdDevM, headingStdDevRad);
```

The pose uses WPILib's blue-origin field frame, the timestamp is FPGA seconds at image capture (or the
vendor's documented equivalent), and uncertainty is positive and explicit. Reject invalid frames
before creating the record. The drivetrain's one authoritative estimator receives the result.

Use the robot footprint, not just the field center point, for the predicate shown below:

```java
private boolean isInsideField(Pose2d pose) {
    return pose.getX() >= ROBOT_RADIUS_M
        && pose.getX() <= FIELD_LENGTH_M - ROBOT_RADIUS_M
        && pose.getY() >= ROBOT_RADIUS_M
        && pose.getY() <= FIELD_WIDTH_M - ROBOT_RADIUS_M;
}
```

## WPILib pose-estimator bridge — compile-checked

The gallery's [`WpilibPoseEstimatorVision`](../src/main/java/dev/bordeaux/examples/vision/WpilibPoseEstimatorVision.java)
turns normalized measurements into WPILib Kalman corrections:

```java
.visionMeasurement(WpilibPoseEstimatorVision.consumer(poseEstimator))
```

It delegates to the three-standard-deviation overload of `addVisionMeasurement`. Keep odometry and
vision in the same `SwerveDrivePoseEstimator`; do not fuse once in a vendor drivetrain and again in a
second Bordeaux estimator. [`VisionObservationFactory`](../src/main/java/dev/bordeaux/examples/vision/VisionObservationFactory.java)
is compile-checked for sources that provide either a capture timestamp or a total-latency value.

## PhotonVision — v2026.3.2 API verified

Drain every unread frame so camera rate and robot-loop rate do not silently drop measurements:

```java
for (var result : camera.getAllUnreadResults()) {
    photonPoseEstimator.update(result).ifPresent(estimate -> {
        Matrix<N3, N1> stdDevs = estimateStdDevs(estimate, result);
        VisionObservationFactory.tryFromCaptureTimestamp(
            "photon-front",
            estimate.estimatedPose.toPose2d(),
            estimate.timestampSeconds,
            stdDevs.get(0, 0), stdDevs.get(1, 0), stdDevs.get(2, 0),
            this::isInsideField)
            .ifPresent(bordeauxDrive::addVisionMeasurement);
    });
}
```

`estimateStdDevs` is team policy: reject unknown tags and non-finite poses, then increase uncertainty
with tag distance/ambiguity and decrease it when multiple well-spaced tags agree. PhotonVision's
official example computes tag-count/distance-dependent uncertainty; `EstimatedRobotPose` itself does
not supply Bordeaux's covariance. See the official
[`PhotonCamera` queue](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photon-lib/src/main/java/org/photonvision/PhotonCamera.java#L244-L262),
[`PhotonPoseEstimator.update`](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photon-lib/src/main/java/org/photonvision/PhotonPoseEstimator.java#L420-L449), and
[`pose-estimation example`](https://github.com/PhotonVision/photonvision/blob/v2026.3.2/photonlib-java-examples/poseest/src/main/java/frc/robot/Vision.java#L86-L119).

Use a distinct source ID per camera and one `PhotonPoseEstimator` per camera transform.

## Limelight MegaTag 2 — helper API verified

Give MegaTag 2 the robot's current orientation before reading its blue-origin estimate:

```java
LimelightHelpers.SetRobotOrientation(
    "limelight-front", robotHeading.getDegrees(), 0, 0, 0, 0, 0);
var estimate = LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2("limelight-front");
if (estimate != null && estimate.tagCount > 0) {
    double xyStdDevM = limelightTranslationStdDev(estimate);
    double headingStdDevRad = limelightHeadingStdDev(estimate);
    VisionObservationFactory.tryFromCaptureTimestamp(
        "limelight-front", estimate.pose, estimate.timestampSeconds,
        xyStdDevM, xyStdDevM, headingStdDevRad, this::isInsideField)
        .ifPresent(bordeauxDrive::addVisionMeasurement);
}
```

`PoseEstimate` reports tag count/span/distance/area but no standard deviations. The two policy methods
must be tuned for the camera placement and rejection gates; returning zero is invalid and pretending
the same certainty at every distance is poor fusion. Limelight documents the exact fields and methods
in [LimelightLib](https://docs.limelightvision.io/docs/docs-limelight/apis/limelight-lib) and its
[MegaTag 2 localization guide](https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2).

Do not switch to a red-origin pose on red alliance. WPILib estimator and Bordeaux path coordinates
remain blue-origin for both alliances.

## QuestNav — 2026 2.2.0 API verified, covariance team-defined

QuestNav has a queue just like a camera. Drain it and keep only tracked poses:

```java
for (var frame : questNav.getAllUnreadPoseFrames()) {
    if (!frame.isTracking()) continue;
    VisionObservationFactory.tryFromCaptureTimestamp(
        "questnav",
        frame.questPose3d().toPose2d(),
        frame.dataTimestamp(),
        QUEST_X_STD_DEV_M,
        QUEST_Y_STD_DEV_M,
        QUEST_HEADING_STD_DEV_RAD,
        this::isInsideField)
        .ifPresent(bordeauxDrive::addVisionMeasurement);
}
```

QuestNav documents `dataTimestamp()` as the NetworkTables reception timestamp for pose estimation;
its app timestamp is diagnostic-only. It does not report Bordeaux's covariance, so the constants must
come from measured repeatability and motion tests. See the official
[`PoseFrame` contract](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/questnav-lib/src/main/java/gg/questnav/questnav/PoseFrame.java#L20-L78)
and [`queue API`](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/questnav-lib/src/main/java/gg/questnav/questnav/QuestNav.java#L600-L646).

`QuestNav.setPose(Pose3d)` resets the headset pose, not the robot pose. Transform a known robot pose
through the robot-to-headset mounting transform first; never forward Bordeaux `resetPose` directly.
The official [troubleshooting note](https://github.com/QuestNav/QuestNav/blob/8c2e963a7f08fac6ea095b06cb0f35dae3770119/docs/versioned_docs/version-2026-2.2.0/1-getting-started/13-troubleshooting.md#L378-L391)
shows that distinction. A stable season vendordep version was not independently verified, so pin the
version selected from QuestNav's installation docs in the robot project.

## Multiple cameras and mixed systems

PhotonVision, Limelight, and QuestNav can coexist. Normalize all accepted measurements, sort the batch
by capture timestamp, and deliver each once:

```java
observations.stream()
    .sorted(Comparator.comparingDouble(BordeauxVisionObservation::captureTimestampS))
    .forEach(bordeauxDrive::addVisionMeasurement);
```

In these snippets, `isInsideField(Pose2d)` is a team-owned blue-origin field/clearance check. The
compile-checked `tryFromCaptureTimestamp` helper rejects null/non-finite poses, invalid timestamps,
non-positive covariance, invalid source IDs, and poses that fail that predicate without throwing from
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
