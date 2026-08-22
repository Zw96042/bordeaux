
        @Override
        public BordeauxDriveState bordeauxState() {
            return state.get();
        }

        @Override
        public void driveRobotRelative(ChassisSpeeds speeds) {
            output.set(speeds);
        }

        @Override
        public void resetPose(Pose2d pose) {
            reset.set(pose);
        }

        @Override
        public void addVisionMeasurement(BordeauxVisionObservation observation) {
            vision.set(observation);
        }

        @Override
        public void stop() {
            stopped = true;
        }
    }
}
