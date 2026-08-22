            double yStdDevM,
            double headingStdDevRad,
            Predicate<Pose2d> isInsideField) {
        Objects.requireNonNull(isInsideField, "isInsideField");
        if (!validSourceId(cameraId)
                || !finitePose(fieldPose)
                || !Double.isFinite(captureTimestampS)
                || captureTimestampS < 0
                || !positiveFinite(xStdDevM)
                || !positiveFinite(yStdDevM)
                || !positiveFinite(headingStdDevRad)
                || !isInsideField.test(fieldPose)) {
            return Optional.empty();
        }
        return Optional.of(new BordeauxVisionObservation(
                cameraId,
                fieldPose,
                captureTimestampS,
                xStdDevM,
                yStdDevM,
                headingStdDevRad));
    }

    /** For APIs that report total latency instead of an absolute FPGA capture timestamp. */
    public static BordeauxVisionObservation fromLatency(
            String cameraId,
            Pose2d fieldPose,
            double receivedAtFpgaTimestampS,
            double totalLatencyS,
            double translationStdDevM,
            double headingStdDevRad) {
        if (!Double.isFinite(totalLatencyS) || totalLatencyS < 0
                || totalLatencyS > receivedAtFpgaTimestampS) {
            throw new IllegalArgumentException("totalLatencyS must fit within the FPGA receipt timestamp");
        }
        return fromCaptureTimestamp(
                cameraId,
                fieldPose,
                receivedAtFpgaTimestampS - totalLatencyS,
                translationStdDevM,
                headingStdDevRad);
    }

    private static boolean finitePose(Pose2d pose) {
        return pose != null
                && Double.isFinite(pose.getX())
                && Double.isFinite(pose.getY())
                && Double.isFinite(pose.getRotation().getRadians());
    }

    private static boolean positiveFinite(double value) {
        return Double.isFinite(value) && value > 0;
    }

    private static boolean validSourceId(String sourceId) {
        return sourceId != null
                && !sourceId.isBlank()
                && sourceId.length() <= 128
                && sourceId.codePoints().noneMatch(Character::isISOControl);
    }
}
