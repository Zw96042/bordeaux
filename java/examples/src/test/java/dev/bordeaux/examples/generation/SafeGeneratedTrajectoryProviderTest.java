            if (!(progress instanceof BordeauxRoutineProgress.Generating)) return progress;
            Thread.sleep(1);
        }
        throw new AssertionError("Generated trajectory did not settle");
    }

    private static final class RecordingFollower implements AquitaineRoutineLoop.MotionFollower {
        private List<BordeauxSample> samples = List.of();
        private boolean finished;
        private int stopCount;
        private int generatedStarts;

        @Override
        public void startPath(String pathId) {}

        @Override
        public void startGenerated(String nodeId, List<BordeauxSample> samples) {
            this.samples = List.copyOf(samples);
            generatedStarts++;
        }

        @Override
        public boolean isFinished() {
            return finished;
        }

        @Override
        public void stop() {
            stopCount++;
        }
    }
}
