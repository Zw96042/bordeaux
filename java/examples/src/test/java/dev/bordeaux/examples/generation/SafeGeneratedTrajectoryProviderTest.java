                "blue-origin",
                () -> context,
                (sample, clearance) -> sample.xM() >= clearance && sample.yM() >= clearance,
                (from, to, clearance) -> true,
                safeStops::incrementAndGet);
        var follower = new RecordingFollower();

        try (var loop = new AquitaineRoutineLoop(runner, follower)) {
            assertInstanceOf(BordeauxRoutineProgress.Generating.class, loop.start());
            var generated = assertInstanceOf(
                    BordeauxRoutineProgress.GeneratedTrajectory.class, settle(loop));

            assertEquals(4, generated.samples().size());
            assertEquals(generated.samples(), follower.samples);
            assertTrue(generated.samples().stream().allMatch(sample -> sample.velocityMps() <= 2 + 1e-9));
            assertTrue(generated.samples().stream()
                    .allMatch(sample -> Math.abs(sample.accelerationMps2()) <= 2 + 1e-9));
            assertEquals(0, safeStops.get());
            follower.finished = true;
            assertInstanceOf(BordeauxRoutineProgress.Waiting.class, loop.periodic());
            assertEquals(1, follower.stopCount);
            Thread.sleep(25);
            assertInstanceOf(BordeauxRoutineProgress.Complete.class, loop.periodic());
        }
        assertEquals(1, follower.stopCount);
    }

    @Test
    void stopsAStaticFollowerBeforeGeneratedWorkBegins() throws Exception {
        var generator = new SafeGeneratedTrajectoryProvider();
        BordeauxCapabilities capabilities = BordeauxBindings.generatedCapabilities(
                new ExistingCommandProvider(Commands.none(), Commands::none, ignored -> Commands.none()),
                generator);
        var context = new BordeauxGenerationContext(
                3, 3, 0, "test-field", "revision", "blue-origin", LIMITS);
        var generatedNode = new BordeauxRoutineNode.GeneratedTrajectory(
                "dynamic", "paths.forward", MAPPER.createObjectNode().put("distanceM", 1),
                new BordeauxRoutineNode.GeneratedFallback.SafeStop());
        var document = new BordeauxPathEvents(
                "auto", "Auto", 1, capabilities.catalogId(), capabilities.catalogHash(),
                List.of(), List.of(), List.of(),
                new BordeauxRoutine("Path then dynamic", List.of(
                        new BordeauxRoutineNode.Path("static", "path-a"),
                        generatedNode)), java.util.Map.of("path-a", List.of()));
        var runner = ContainedGeneratedRoutine.create(
                document, capabilities,
                "test-field", "revision", "blue-origin",
                () -> context,
                (sample, clearance) -> true,
                (from, to, clearance) -> true,
                () -> {});
        var follower = new RecordingFollower();

        try (var loop = new AquitaineRoutineLoop(runner, follower)) {
            assertEquals(new BordeauxRoutineProgress.Path("path-a"), loop.start());
            follower.finished = true;

            assertInstanceOf(BordeauxRoutineProgress.Generating.class, loop.periodic());
            assertEquals(1, follower.stopCount);
            assertInstanceOf(BordeauxRoutineProgress.GeneratedTrajectory.class, settle(loop));
            assertEquals(1, follower.generatedStarts);
        }
        assertEquals(2, follower.stopCount);
    }

    @Test
    void doesNotRepeatTheContainmentSafeStopThroughTheFollower() throws Exception {
        var generator = new SafeGeneratedTrajectoryProvider();
        BordeauxCapabilities capabilities = BordeauxBindings.generatedCapabilities(
                new ExistingCommandProvider(Commands.none(), Commands::none, ignored -> Commands.none()),
                generator);
        var movingContext = new BordeauxGenerationContext(
                3, 3, 0, "test-field", "revision", "blue-origin", LIMITS,
                0.1, 0, 0);
        var generatedNode = new BordeauxRoutineNode.GeneratedTrajectory(
                "dynamic", "paths.forward", MAPPER.createObjectNode().put("distanceM", 1),
                new BordeauxRoutineNode.GeneratedFallback.SafeStop());
        var document = new BordeauxPathEvents(
                "auto", "Auto", 1, capabilities.catalogId(), capabilities.catalogHash(),
                List.of(), List.of(), List.of(),
                new BordeauxRoutine("Unsafe dynamic", List.of(generatedNode)));
        AtomicInteger safeStops = new AtomicInteger();
        var runner = ContainedGeneratedRoutine.create(
                document, capabilities,
                "test-field", "revision", "blue-origin",
                () -> movingContext,
                (sample, clearance) -> true,
                (from, to, clearance) -> true,
                safeStops::incrementAndGet);
        var follower = new RecordingFollower();

        try (var loop = new AquitaineRoutineLoop(runner, follower)) {
            assertInstanceOf(BordeauxRoutineProgress.Generating.class, loop.start());
            assertInstanceOf(BordeauxRoutineProgress.SafeStopped.class, settle(loop));
            assertEquals(1, safeStops.get());
            assertEquals(0, follower.stopCount);
        }
        assertEquals(0, follower.stopCount);
    }

    private static BordeauxRoutineProgress settle(AquitaineRoutineLoop loop) throws InterruptedException {
        for (int count = 0; count < 1_000; count++) {
            BordeauxRoutineProgress progress = loop.periodic();
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
