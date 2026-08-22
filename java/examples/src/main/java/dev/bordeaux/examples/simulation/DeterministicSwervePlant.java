        Pose2d pose = state.pose();
        double heading = pose.getRotation().getRadians();
        double fieldVelocityX = request.vxMetersPerSecond * Math.cos(heading)
                - request.vyMetersPerSecond * Math.sin(heading);
        double fieldVelocityY = request.vxMetersPerSecond * Math.sin(heading)
                + request.vyMetersPerSecond * Math.cos(heading);
        var nextPose = new Pose2d(
                pose.getX() + fieldVelocityX * dtS,
                pose.getY() + fieldVelocityY * dtS,
                new Rotation2d(heading + request.omegaRadiansPerSecond * dtS));
        state = new BordeauxDriveState(nextPose, request, state.timestampS() + dtS);
    }

    private void accept(ChassisSpeeds speeds) {
        request = new ChassisSpeeds(
                speeds.vxMetersPerSecond,
                speeds.vyMetersPerSecond,
                speeds.omegaRadiansPerSecond);
    }

    private void resetPose(Pose2d pose) {
        state = new BordeauxDriveState(pose, request, state.timestampS());
    }

    private void stop() {
        request = new ChassisSpeeds();
    }
}
