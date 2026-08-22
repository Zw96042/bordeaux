    @Test
    void stopZerosTheAppliedRequest() {
        var plant = new DeterministicSwervePlant();
        var drive = plant.drive(LIMITS);
        drive.driveRobotRelative(new ChassisSpeeds(1, -0.5, 0.25));

        drive.stop();

        assertEquals(0, plant.request().vxMetersPerSecond);
        assertEquals(0, plant.request().vyMetersPerSecond);
        assertEquals(0, plant.request().omegaRadiansPerSecond);
    }

    private static Pose2d runTrace() {
        var plant = new DeterministicSwervePlant();
        var drive = plant.drive(LIMITS);
        drive.driveRobotRelative(new ChassisSpeeds(1, 0.3, 0.5));
        for (int step = 0; step < 200; step++) plant.step(0.02);
        return drive.state().pose();
    }
}
