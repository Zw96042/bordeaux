        BordeauxDriveState expected = new BordeauxDriveState(new Pose2d(), new ChassisSpeeds(), 4.2);
        BordeauxDrive drive = BordeauxDriveAdapter.forSubsystem(new Subsystem() {})
                .state(() -> expected)
                .output(speeds -> {})
                .resetPose(pose -> {})
                .stop(() -> {})
                .limits(new BordeauxDriveLimits(4, 6, 8, 10))
                .build();

        assertSame(expected, drive.state());
    }
}
