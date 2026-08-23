package dev.bordeaux.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import edu.wpi.first.wpilibj2.command.Command;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class BordeauxGeneratedTrajectoryRuntimeTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CATALOG_ID = "test-robot";
    private static final String HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static final BordeauxTrajectoryGeneratorLimits DESCRIPTOR_LIMITS = new BordeauxTrajectoryGeneratorLimits(
            50, 512, 5, 12, 4, 8, 6, 10, 20, 0.2);
    private static final BordeauxTrajectoryGeneratorLimits ROBOT_LIMITS = new BordeauxTrajectoryGeneratorLimits(
            40, 128, 3, 8, 2, 4, 4, 6, 12, 0.3);

    @Test
    void exposesOnlyACompletelyValidatedGeneratedTrajectoryThenContinuesTheRoutine() throws Exception {
        AtomicInteger fieldChecks = new AtomicInteger();
        AtomicInteger collisionChecks = new AtomicInteger();
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> validTrajectory());
        BordeauxGeneratedTrajectorySafety safety = safety(() -> context(),
                (sample, clearanceM) -> {
                    assertEquals(0.3, clearanceM);
                    fieldChecks.incrementAndGet();
                    return sample.xM() >= clearanceM && sample.xM() <= 16 - clearanceM
                            && sample.yM() >= clearanceM && sample.yM() <= 8 - clearanceM;
                }, (from, to, clearanceM) -> {
                    assertEquals(0.3, clearanceM);
                    collisionChecks.incrementAndGet();
                    return true;
                }, safeStops::incrementAndGet);
        BordeauxRoutine routine = new BordeauxRoutine("Dynamic", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()),
                generated("dynamic-2", new BordeauxRoutineNode.GeneratedFallback.SafeStop()),
                new BordeauxRoutineNode.Path("finish", "static-finish")));
        double[] time = {10};
        BordeauxRoutineRunner runner = runner(routine, capabilities, safety, time);

        assertEquals(new BordeauxRoutineProgress.Generating("dynamic", "detour"), runner.startProgress());
        BordeauxRoutineProgress.GeneratedTrajectory generated =
                (BordeauxRoutineProgress.GeneratedTrajectory) settle(runner);
        assertEquals("dynamic", generated.nodeId());
        assertEquals(validTrajectory().samples().get(0), generated.samples().get(0));
        assertEquals(2, generated.samples().get(1).velocityMps());
        assertEquals(2, generated.samples().get(1).accelerationMps2());
        assertEquals(0, generated.samples().get(1).angularVelocityRadps());
        assertEquals(0, generated.samples().get(1).curvatureInvM());
        assertEquals(0, generated.samples().get(1).travelHeadingRad());
        assertEquals(2, generated.samples().get(1).fieldVelocityXMps());
        assertEquals(0, generated.samples().get(1).fieldVelocityYMps());
        assertEquals(2, fieldChecks.get());
        assertEquals(1, collisionChecks.get());
        assertEquals(0, safeStops.get());
        assertEquals(new BordeauxRoutineProgress.Generating("dynamic-2", "detour"),
                runner.completeGeneratedTrajectoryProgress("dynamic"));
        assertTrue(settle(runner) instanceof BordeauxRoutineProgress.GeneratedTrajectory);
        assertEquals(4, fieldChecks.get());
        assertEquals(2, collisionChecks.get());
        assertEquals(new BordeauxRoutineProgress.Path("static-finish"),
                runner.completeGeneratedTrajectoryProgress("dynamic-2"));
    }

    @Test
    void alignsGeneratedAccelerationAndTerminalVelocityToSampleTimestamps() throws Exception {
        BordeauxGeneratedTrajectory braking = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 99, 99, 99, 99),
                new BordeauxSample(1, 1, 1, 1, 2, 1, 0, 99, 99, 99, 99)));
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> braking);
        BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", ROBOT_LIMITS, 2, 0, 0);
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Brake", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> moving, (sample, clearance) -> true, (from, to, clearance) -> true, () -> {}),
                new double[] {0});

        runner.startProgress();
        BordeauxRoutineProgress.GeneratedTrajectory generated =
                (BordeauxRoutineProgress.GeneratedTrajectory) settle(runner);

        assertEquals(2, generated.samples().get(0).velocityMps());
        assertEquals(0, generated.samples().get(1).velocityMps());
        assertEquals(-2, generated.samples().get(1).accelerationMps2());
        assertEquals(0, generated.samples().get(1).angularVelocityRadps());
        assertEquals(0, generated.samples().get(1).curvatureInvM());
    }

    @Test
    void rejectsInitialMotionAboveTheStricterDescriptorLimits() throws Exception {
        BordeauxTrajectoryGeneratorLimits robotLimits = new BordeauxTrajectoryGeneratorLimits(
                50, 512, 5, 12, 6, 8, 6, 12, 20, 0.2);
        for (boolean angular : List.of(false, true)) {
            BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                    "2026-rebuilt", "rev", "bordeaux-field/1.0", robotLimits,
                    angular ? 0 : 5, 0, angular ? 11 : 0);
            // Both trajectories brake to an allowed endpoint, so the initial state
            // must be checked independently of the subsequent sample limits.
            double duration = angular ? 0.5 : 1;
            double distance = angular ? 0 : 2.5;
            double heading = angular ? 3 : 0;
            BordeauxGeneratedTrajectory braking = new BordeauxGeneratedTrajectory(List.of(
                    new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                    new BordeauxSample(1, duration, distance, 1, 1 + distance, 1, heading, 0)));
            BordeauxCapabilities capabilities = capabilities(
                    BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                    (context, arguments) -> braking);
            AtomicInteger safeStops = new AtomicInteger();
            BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Brake", List.of(
                    generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                    safety(() -> moving, (sample, clearance) -> true,
                            (from, to, clearance) -> true, safeStops::incrementAndGet), new double[] {0});

            runner.startProgress();
            assertTrue(settle(runner) instanceof BordeauxRoutineProgress.SafeStopped);
            assertEquals(1, safeStops.get());
        }
    }

    @Test
    void rejectsAHiddenDirectionReversalInsideAZeroDistanceSegment() throws Exception {
        BordeauxGeneratedTrajectory reversal = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 1),
                new BordeauxSample(1, 1, 0, 1, 1, 1, 0, 1)));
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> reversal);
        BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", ROBOT_LIMITS, 1, 0, 0);
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Reverse", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> moving, (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();

        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void timesOutOffThreadGenerationAndSafeStopsExactlyOnce() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch interruptionObserved = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> {
                    entered.countDown();
                    try {
                        release.await();
                    } catch (InterruptedException exception) {
                        interrupted.set(true);
                        interruptionObserved.countDown();
                        Thread.currentThread().interrupt();
                    }
                    return validTrajectory();
                });
        double[] time = {0};
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Timeout", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> context(), (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), time);

        assertEquals(new BordeauxRoutineProgress.Generating("dynamic", "detour"), runner.startProgress());
        assertTrue(entered.await(1, TimeUnit.SECONDS));
        time[0] = 0.041;
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), runner.periodic());
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), runner.periodic());
        assertEquals(1, safeStops.get());
        assertTrue(interruptionObserved.await(1, TimeUnit.SECONDS));
        assertTrue(interrupted.get());
        release.countDown();
    }

    @Test
    void thrownOrInvalidOutputUsesOnlyAnExplicitValidatedFallback() throws Exception {
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.VALIDATED_BRANCH,
                (context, arguments) -> { throw new IllegalStateException("team generator failed"); });
        BordeauxRoutineNode.GeneratedFallback.Branch fallback = new BordeauxRoutineNode.GeneratedFallback.Branch(
                List.of(new BordeauxRoutineNode.Path("fallback", "fallback-path")));
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Fallback", List.of(generated(fallback))), capabilities,
                safety(() -> context(), (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();
        assertEquals(new BordeauxRoutineProgress.Path("fallback-path"), settle(runner));
        assertEquals(0, safeStops.get());

        BordeauxCapabilities invalid = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> new BordeauxGeneratedTrajectory(List.of(
                        new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                        new BordeauxSample(1, 1, 1, 1, 2, 1, 0, 1, Double.NaN, 0, 0))));
        BordeauxRoutineRunner invalidRunner = runner(new BordeauxRoutine("Invalid", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), invalid,
                safety(() -> context(), (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});
        invalidRunner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(invalidRunner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void rejectsRuntimeLimitFieldAndCollisionViolationsBeforeSamplesEscape() throws Exception {
        List<BordeauxGeneratedTrajectory> candidates = List.of(
                new BordeauxGeneratedTrajectory(List.of(
                        new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                        new BordeauxSample(1, 0.1, 1, 1, 2, 1, 0, 10))),
                validTrajectory(),
                validTrajectory());
        for (int index = 0; index < candidates.size(); index++) {
            int candidate = index;
            AtomicInteger safeStops = new AtomicInteger();
            BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                    (context, arguments) -> candidates.get(candidate));
            BordeauxGeneratedTrajectorySafety safety = safety(() -> context(),
                    (sample, clearance) -> candidate != 1,
                    (from, to, clearance) -> candidate != 2,
                    safeStops::incrementAndGet);
            BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Invalid", List.of(
                    generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities, safety,
                    new double[] {0});

            runner.startProgress();
            assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
            assertEquals(1, safeStops.get());
        }
    }

    @Test
    void derivesAccelerationFromXyMotionInsteadOfTrustingDeclaredVelocity() throws Exception {
        BordeauxGeneratedTrajectory forged = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                new BordeauxSample(1, 0.1, 0.1, 0.5, 1.1, 1, 0, 0),
                new BordeauxSample(2, 0.2, 0.3, 1, 1.3, 1, 0, 0)));
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> forged);
        BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", ROBOT_LIMITS, 1, 0, 0);
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Acceleration", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> moving, (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void derivesCentripetalAccelerationFromXyCurvatureInsteadOfRobotHeading() throws Exception {
        BordeauxGeneratedTrajectory rightAngle = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 1),
                new BordeauxSample(1, 1, 1, 0.5, 2, 1, 0, 1),
                new BordeauxSample(2, 2, 2, 1, 2, 2, 0, 1)));
        BordeauxTrajectoryGeneratorLimits turningLimits = new BordeauxTrajectoryGeneratorLimits(
                40, 128, 3, 8, 2, 10, 1, 6, 12, 0.3);
        BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", turningLimits, 1, 0, 0);
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> rightAngle);
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Curvature", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> moving, (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void boundsContextToFirstSegmentAccelerationAtTheSegmentMidpoint() throws Exception {
        BordeauxGeneratedTrajectory initialAcceleration = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                new BordeauxSample(1, 0.2, 0.12, 1, 1.12, 1, 0, 0)));
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> initialAcceleration);
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Initial acceleration", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(BordeauxGeneratedTrajectoryRuntimeTest::context,
                        (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void checksInitialCurvatureAgainstTheCurrentFieldVelocityDirection() throws Exception {
        BordeauxGeneratedTrajectory initialTurn = new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 1),
                new BordeauxSample(1, 1, 1, 1, 1, 2, 0, 1)));
        BordeauxTrajectoryGeneratorLimits turningLimits = new BordeauxTrajectoryGeneratorLimits(
                40, 128, 3, 8, 2, 10, 1, 6, 12, 0.3);
        BordeauxGenerationContext moving = new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", turningLimits, 1, 0, 0);
        AtomicInteger safeStops = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> initialTurn);
        BordeauxRoutineRunner runner = runner(new BordeauxRoutine("Initial curvature", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop()))), capabilities,
                safety(() -> moving, (sample, clearance) -> true, (from, to, clearance) -> true,
                        safeStops::incrementAndGet), new double[] {0});

        runner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(runner));
        assertEquals(1, safeStops.get());
    }

    @Test
    void preflightsCatalogFieldAndFallbackPolicyBeforeInvokingTeamCode() throws Exception {
        AtomicInteger invocations = new AtomicInteger();
        BordeauxCapabilities capabilities = capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.SAFE_STOP_ONLY,
                (context, arguments) -> {
                    invocations.incrementAndGet();
                    return validTrajectory();
                });
        BordeauxRuntimeCompatibility wrongCatalog = new BordeauxRuntimeCompatibility(
                "other", HASH, "0.4.0", "2026-rebuilt", "rev", "bordeaux-field/1.0");
        BordeauxGeneratedTrajectorySafety wrongSafety = new BordeauxGeneratedTrajectorySafety(wrongCatalog,
                BordeauxGeneratedTrajectoryRuntimeTest::context, (sample, clearance) -> true,
                (from, to, clearance) -> true, () -> {});
        BordeauxRoutine routine = new BordeauxRoutine("Mismatch", List.of(
                generated(new BordeauxRoutineNode.GeneratedFallback.SafeStop())));

        assertThrows(BordeauxRuntimeException.class, () -> runner(routine, capabilities, wrongSafety, new double[] {0}));
        AtomicInteger contextSafeStops = new AtomicInteger();
        BordeauxGeneratedTrajectorySafety wrongField = safety(
                () -> new BordeauxGenerationContext(1, 1, 0,
                        "other-field", "rev", "bordeaux-field/1.0", ROBOT_LIMITS),
                (sample, clearance) -> true, (from, to, clearance) -> true,
                contextSafeStops::incrementAndGet);
        BordeauxRoutineRunner wrongFieldRunner = runner(routine, capabilities, wrongField, new double[] {0});
        wrongFieldRunner.startProgress();
        assertEquals(new BordeauxRoutineProgress.SafeStopped("dynamic", "detour"), settle(wrongFieldRunner));
        assertEquals(1, contextSafeStops.get());
        BordeauxRoutineNode.GeneratedFallback.Branch wrongFallback = new BordeauxRoutineNode.GeneratedFallback.Branch(
                List.of(new BordeauxRoutineNode.Path("fallback", "fallback-path")));
        assertThrows(BordeauxRuntimeException.class, () -> runner(new BordeauxRoutine("Policy", List.of(
                generated(wrongFallback))), capabilities,
                safety(BordeauxGeneratedTrajectoryRuntimeTest::context, (sample, clearance) -> true,
                        (from, to, clearance) -> true, () -> {}), new double[] {0}));
        BordeauxCapabilities branchCapabilities = capabilities(
                BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.VALIDATED_BRANCH,
                (context, arguments) -> validTrajectory());
        BordeauxRoutineNode.GeneratedFallback.Branch unknownCommand = new BordeauxRoutineNode.GeneratedFallback.Branch(
                List.of(new BordeauxRoutineNode.Command("unknown", "missing", (ObjectNode) MAPPER.readTree("{}")),
                        new BordeauxRoutineNode.Path("fallback", "fallback-path")));
        assertThrows(BordeauxRuntimeException.class, () -> runner(new BordeauxRoutine("Command", List.of(
                generated(unknownCommand))), branchCapabilities,
                safety(BordeauxGeneratedTrajectoryRuntimeTest::context, (sample, clearance) -> true,
                        (from, to, clearance) -> true, () -> {}), new double[] {0}));

        AtomicInteger factories = new AtomicInteger();
        BordeauxCommandRegistry typedCommands = BordeauxCommandRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH)
                .register("drive", Set.of("speed"),
                        arguments -> arguments.requireDouble("speed", "0", "1"),
                        arguments -> {
                            factories.incrementAndGet();
                            return new TestCommand();
                        })
                .build();
        BordeauxTrajectoryGeneratorRegistry branchGenerators = BordeauxTrajectoryGeneratorRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH)
                .register("detour", Set.of(), DESCRIPTOR_LIMITS,
                        BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.VALIDATED_BRANCH,
                        (context, arguments) -> validTrajectory())
                .build();
        BordeauxCapabilities typedCapabilities = new BordeauxCapabilities(typedCommands,
                BordeauxConditionRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build(), branchGenerators);
        BordeauxRoutineNode.GeneratedFallback.Branch malformedCommand = new BordeauxRoutineNode.GeneratedFallback.Branch(
                List.of(new BordeauxRoutineNode.Command("drive", "drive", (ObjectNode) MAPPER.readTree("{}")),
                        new BordeauxRoutineNode.Path("fallback", "fallback-path")));
        assertThrows(BordeauxRuntimeException.class, () -> runner(new BordeauxRoutine("Typed command", List.of(
                generated(malformedCommand))), typedCapabilities,
                safety(BordeauxGeneratedTrajectoryRuntimeTest::context, (sample, clearance) -> true,
                        (from, to, clearance) -> true, () -> {}), new double[] {0}));
        assertEquals(0, factories.get());
        assertEquals(0, invocations.get());
    }

    private static BordeauxRoutineRunner runner(BordeauxRoutine routine, BordeauxCapabilities capabilities,
            BordeauxGeneratedTrajectorySafety safety, double[] time) {
        BordeauxPathEvents document = new BordeauxPathEvents("auto", "Auto", 1, CATALOG_ID, HASH,
                List.of(), List.of(), List.of(), routine, java.util.Map.of(
                        "fallback-path", List.of(), "static-finish", List.of()));
        return new BordeauxRoutineRunner(document, capabilities, new NoopScheduler(), () -> time[0], safety);
    }

    private static BordeauxCapabilities capabilities(BordeauxTrajectoryGeneratorRegistry.FallbackPolicy policy,
            BordeauxTrajectoryGeneratorRegistry.Generator generator) {
        BordeauxCommandRegistry commands = BordeauxCommandRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build();
        BordeauxConditionRegistry conditions = BordeauxConditionRegistry.builder().catalogId(CATALOG_ID).catalogHash(HASH).build();
        BordeauxTrajectoryGeneratorRegistry generators = BordeauxTrajectoryGeneratorRegistry.builder()
                .catalogId(CATALOG_ID).catalogHash(HASH)
                .register("detour", Set.of(), DESCRIPTOR_LIMITS, policy, generator)
                .build();
        return new BordeauxCapabilities(commands, conditions, generators);
    }

    private static BordeauxGeneratedTrajectorySafety safety(
            java.util.function.Supplier<BordeauxGenerationContext> context,
            BordeauxGeneratedTrajectorySafety.FieldValidator field,
            BordeauxGeneratedTrajectorySafety.CollisionValidator collision,
            Runnable safeStop) {
        return new BordeauxGeneratedTrajectorySafety(new BordeauxRuntimeCompatibility(
                CATALOG_ID, HASH, "0.4.0", "2026-rebuilt", "rev", "bordeaux-field/1.0"),
                context, field, collision, safeStop);
    }

    private static BordeauxGenerationContext context() {
        return new BordeauxGenerationContext(1, 1, 0,
                "2026-rebuilt", "rev", "bordeaux-field/1.0", ROBOT_LIMITS);
    }

    private static BordeauxGeneratedTrajectory validTrajectory() {
        return new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0, 1, 1, 0, 0),
                new BordeauxSample(1, 1, 1, 1, 2, 1, 0, 1)));
    }

    private static BordeauxRoutineNode.GeneratedTrajectory generated(BordeauxRoutineNode.GeneratedFallback fallback)
            throws Exception {
        return generated("dynamic", fallback);
    }

    private static BordeauxRoutineNode.GeneratedTrajectory generated(
            String id, BordeauxRoutineNode.GeneratedFallback fallback) throws Exception {
        return new BordeauxRoutineNode.GeneratedTrajectory(id, "detour",
                (ObjectNode) MAPPER.readTree("{}"), fallback);
    }

    private static BordeauxRoutineProgress settle(BordeauxRoutineRunner runner) throws InterruptedException {
        for (int count = 0; count < 1_000; count++) {
            BordeauxRoutineProgress progress = runner.periodic();
            if (!(progress instanceof BordeauxRoutineProgress.Generating)) return progress;
            Thread.sleep(1);
        }
        throw new AssertionError("Generated trajectory did not settle");
    }

    private static final class NoopScheduler implements BordeauxEventRunner.Scheduler {
        @Override
        public void schedule(Command command) {}

        @Override
        public void cancel(Command command) {}
    }

    private static final class TestCommand extends Command {}
}
