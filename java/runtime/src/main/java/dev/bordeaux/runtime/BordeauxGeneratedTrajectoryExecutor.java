package dev.bordeaux.runtime;

import java.util.List;
import java.util.Objects;
import java.util.function.DoubleSupplier;

/** Owns one off-thread generator invocation and validates its complete output before release. */
final class BordeauxGeneratedTrajectoryExecutor implements AutoCloseable {
    sealed interface PollResult {
        record Pending() implements PollResult {}
        record Valid(List<BordeauxSample> samples) implements PollResult {
            public Valid {
                samples = List.copyOf(samples);
            }
        }
        record Failed() implements PollResult {}
    }

    private static final double EPSILON = 1e-9;
    private static final double START_POSITION_TOLERANCE_M = 1e-6;
    private static final double START_HEADING_TOLERANCE_RAD = 1e-6;

    private final BordeauxTrajectoryGeneratorRegistry generators;
    private final BordeauxGeneratedTrajectorySafety safety;
    private final DoubleSupplier clock;
    private Attempt active;

    BordeauxGeneratedTrajectoryExecutor(BordeauxCapabilities capabilities,
            BordeauxGeneratedTrajectorySafety safety, DoubleSupplier clock, List<BordeauxRoutineNode> nodes) {
        Objects.requireNonNull(capabilities, "capabilities");
        this.generators = capabilities.trajectoryGenerators();
        this.safety = Objects.requireNonNull(safety, "safety");
        this.clock = Objects.requireNonNull(clock, "clock");
        BordeauxRuntimeCompatibility compatibility = safety.compatibility();
        if (!capabilities.catalogId().equals(compatibility.catalogId())
                || !capabilities.catalogHash().equals(compatibility.catalogHash())) {
            throw new BordeauxRuntimeException("Generated trajectory safety catalog does not match compiled capabilities");
        }
        preflight(nodes, false);
    }

    void start(BordeauxRoutineNode.GeneratedTrajectory node) {
        if (active != null) throw new BordeauxRuntimeException("A generated trajectory is already active");
        BordeauxTrajectoryGeneratorRegistry.Entry entry = generators.resolve(node.generatorId());
        Attempt attempt;
        try {
            BordeauxGenerationContext context = Objects.requireNonNull(
                    safety.generationContext().get(), "generationContext returned null");
            validateContext(context);
            BordeauxTrajectoryGeneratorLimits limits = stricter(entry.limits(), context.safetyLimits());
            double startedAtS = now();
            double deadlineS = startedAtS + limits.timeoutMs() / 1_000.0;
            if (!Double.isFinite(deadlineS) || deadlineS <= startedAtS) {
                throw new BordeauxRuntimeException("Generated trajectory deadline is not finite");
            }
            attempt = new Attempt(node, context, limits, deadlineS);
            active = attempt;
            attempt.start();
            return;
        } catch (RuntimeException failure) {
            attempt = new Attempt(node);
        }
        active = attempt;
    }

    PollResult poll() {
        Attempt attempt = active;
        if (attempt == null) throw new BordeauxRuntimeException("No generated trajectory is active");
        Completion completion = attempt.completion;
        if (completion != null) {
            if (completion.completedAtS > attempt.deadlineS + EPSILON || completion.samples == null) {
                return new PollResult.Failed();
            }
            return new PollResult.Valid(completion.samples);
        }
        if (now() + EPSILON >= attempt.deadlineS) {
            completion = attempt.completion;
            if (completion != null && completion.completedAtS <= attempt.deadlineS + EPSILON
                    && completion.samples != null) {
                return new PollResult.Valid(completion.samples);
            }
            attempt.cancel();
            return new PollResult.Failed();
        }
        return new PollResult.Pending();
    }

    void clear() {
        active = null;
    }

    void safeStop() {
        safety.safeStop().run();
    }

    private void validateContext(BordeauxGenerationContext context) {
        BordeauxRuntimeCompatibility compatibility = safety.compatibility();
        if (!compatibility.fieldId().equals(context.fieldId())
                || !compatibility.fieldRevision().equals(context.fieldRevision())
                || !compatibility.fieldCoordinateSchemaId().equals(context.fieldCoordinateSchemaId())) {
            throw new BordeauxRuntimeException("Generated trajectory context field does not match compiled compatibility");
        }
    }

    private void preflight(List<BordeauxRoutineNode> nodes, boolean fallback) {
        for (BordeauxRoutineNode node : nodes) {
            if (node instanceof BordeauxRoutineNode.Decision decision) {
                preflight(decision.whenTrue(), fallback);
                preflight(decision.whenFalse(), fallback);
            } else if (node instanceof BordeauxRoutineNode.GeneratedTrajectory generated) {
                if (fallback) {
                    throw new BordeauxRuntimeException("Generated trajectory fallback cannot contain another generator");
                }
                BordeauxTrajectoryGeneratorRegistry.Entry entry = generators.resolve(generated.generatorId());
                boolean branch = generated.fallback() instanceof BordeauxRoutineNode.GeneratedFallback.Branch;
                if (branch != (entry.fallbackPolicy()
                        == BordeauxTrajectoryGeneratorRegistry.FallbackPolicy.VALIDATED_BRANCH)) {
                    throw new BordeauxRuntimeException("Generated trajectory fallback does not match its catalog policy");
                }
                if (generated.fallback() instanceof BordeauxRoutineNode.GeneratedFallback.Branch value) {
                    preflight(value.nodes(), true);
                    if (canFinishWithoutPath(value.nodes())) {
                        throw new BordeauxRuntimeException("Every generated trajectory fallback route must reach a static path");
                    }
                }
            }
        }
    }

    private static boolean canFinishWithoutPath(List<BordeauxRoutineNode> nodes) {
        boolean pathMissing = true;
        for (BordeauxRoutineNode node : nodes) {
            if (!pathMissing) return false;
            if (node instanceof BordeauxRoutineNode.Path) {
                pathMissing = false;
            } else if (node instanceof BordeauxRoutineNode.Decision decision) {
                pathMissing = canFinishWithoutPath(decision.whenTrue()) || canFinishWithoutPath(decision.whenFalse());
            }
        }
        return pathMissing;
    }

    private static BordeauxTrajectoryGeneratorLimits stricter(
            BordeauxTrajectoryGeneratorLimits descriptor, BordeauxTrajectoryGeneratorLimits robot) {
        return new BordeauxTrajectoryGeneratorLimits(
                Math.min(descriptor.timeoutMs(), robot.timeoutMs()),
                Math.min(descriptor.maxSamples(), robot.maxSamples()),
                Math.min(descriptor.maxDurationS(), robot.maxDurationS()),
                Math.min(descriptor.maxDistanceM(), robot.maxDistanceM()),
                Math.min(descriptor.maxVelocityMps(), robot.maxVelocityMps()),
                Math.min(descriptor.maxAccelerationMps2(), robot.maxAccelerationMps2()),
                Math.min(descriptor.maxCentripetalAccelerationMps2(), robot.maxCentripetalAccelerationMps2()),
                Math.min(descriptor.maxAngularVelocityRadps(), robot.maxAngularVelocityRadps()),
                Math.min(descriptor.maxAngularAccelerationRadps2(), robot.maxAngularAccelerationRadps2()),
                Math.max(descriptor.minClearanceM(), robot.minClearanceM()));
    }

    private List<BordeauxSample> validate(BordeauxGeneratedTrajectory trajectory,
            BordeauxGenerationContext context, BordeauxTrajectoryGeneratorLimits limits) {
        if (trajectory == null) throw new BordeauxRuntimeException("Generated trajectory returned null");
        List<BordeauxSample> samples = trajectory.samples();
        if (samples.size() < 2 || samples.size() > limits.maxSamples()) {
            throw new BordeauxRuntimeException("Generated trajectory sample count is outside runtime limits");
        }
        double geometricDistanceM = 0;
        double previousVelocityX = context.velocityXMps();
        double previousVelocityY = context.velocityYMps();
        double previousAngularVelocity = context.angularVelocityRadps();
        double previousSegmentDurationS = Double.NaN;
        double contextSpeed = Math.hypot(previousVelocityX, previousVelocityY);
        double previousSegmentDirection = contextSpeed > EPSILON
                ? Math.atan2(previousVelocityY, previousVelocityX) : Double.NaN;
        double previousSegmentDistanceM = 0;
        for (int index = 0; index < samples.size(); index++) {
            BordeauxSample sample = samples.get(index);
            if (sample == null || sample.index() != index || !finite(sample)) {
                throw new BordeauxRuntimeException("Generated trajectory samples must be finite and sequentially indexed");
            }
            if (sample.timeS() < -EPSILON || sample.distanceM() < -EPSILON
                    || sample.fraction() < -EPSILON || sample.fraction() > 1 + EPSILON
                    || Math.abs(sample.velocityMps()) > limits.maxVelocityMps() + EPSILON) {
                throw new BordeauxRuntimeException("Generated trajectory sample exceeds runtime bounds");
            }
            if (!safety.fieldValidator().contains(sample, limits.minClearanceM())) {
                throw new BordeauxRuntimeException("Generated trajectory leaves the validated field region");
            }
            if (index == 0) {
                if (Math.abs(sample.timeS()) > EPSILON || Math.abs(sample.distanceM()) > EPSILON
                        || Math.abs(sample.fraction()) > EPSILON
                        || Math.hypot(sample.xM() - context.xM(), sample.yM() - context.yM())
                                > START_POSITION_TOLERANCE_M
                        || Math.abs(angleDifference(sample.headingRad(), context.headingRad()))
                                > START_HEADING_TOLERANCE_RAD) {
                    throw new BordeauxRuntimeException("Generated trajectory must start at the current robot pose");
                }
                continue;
            }
            BordeauxSample previous = samples.get(index - 1);
            double elapsedS = sample.timeS() - previous.timeS();
            double distanceDeltaM = sample.distanceM() - previous.distanceM();
            double fractionDelta = sample.fraction() - previous.fraction();
            if (elapsedS <= EPSILON || distanceDeltaM < -EPSILON || fractionDelta < -EPSILON) {
                throw new BordeauxRuntimeException("Generated trajectory samples must be time and distance ordered");
            }
            double segmentDistanceM = Math.hypot(sample.xM() - previous.xM(), sample.yM() - previous.yM());
            double velocityX = (sample.xM() - previous.xM()) / elapsedS;
            double velocityY = (sample.yM() - previous.yM()) / elapsedS;
            double geometricSpeed = Math.hypot(velocityX, velocityY);
            double accelerationIntervalS = Double.isFinite(previousSegmentDurationS)
                    ? (previousSegmentDurationS + elapsedS) / 2 : elapsedS / 2;
            geometricDistanceM += segmentDistanceM;
            if (distanceDeltaM + EPSILON < segmentDistanceM
                    || geometricDistanceM > limits.maxDistanceM() + EPSILON
                    || sample.distanceM() > limits.maxDistanceM() + EPSILON
                    || geometricSpeed > limits.maxVelocityMps() + EPSILON
                    || Math.hypot(velocityX - previousVelocityX, velocityY - previousVelocityY)
                            / accelerationIntervalS > limits.maxAccelerationMps2() + EPSILON
                    || Math.abs(sample.velocityMps() - previous.velocityMps()) / elapsedS
                            > limits.maxAccelerationMps2() + EPSILON) {
                throw new BordeauxRuntimeException("Generated trajectory exceeds robot translational limits");
            }
            double headingDelta = angleDifference(sample.headingRad(), previous.headingRad());
            double angularVelocity = headingDelta / elapsedS;
            if (Math.abs(angularVelocity) > limits.maxAngularVelocityRadps() + EPSILON
                    || Math.abs(angularVelocity - previousAngularVelocity) / accelerationIntervalS
                            > limits.maxAngularAccelerationRadps2() + EPSILON) {
                throw new BordeauxRuntimeException("Generated trajectory exceeds robot angular limits");
            }
            double segmentDirection = segmentDistanceM > EPSILON
                    ? Math.atan2(sample.yM() - previous.yM(), sample.xM() - previous.xM()) : Double.NaN;
            if (Double.isFinite(previousSegmentDirection) && Double.isFinite(segmentDirection)) {
                double curvature = Math.abs(angleDifference(segmentDirection, previousSegmentDirection))
                        / Math.max((previousSegmentDistanceM + segmentDistanceM) / 2, EPSILON);
                double centripetalSpeed = Math.max(
                        Math.hypot(previousVelocityX, previousVelocityY), geometricSpeed);
                if (centripetalSpeed * centripetalSpeed * curvature
                        > limits.maxCentripetalAccelerationMps2() + EPSILON) {
                    throw new BordeauxRuntimeException("Generated trajectory exceeds robot centripetal limits");
                }
            }
            if (!safety.collisionValidator().isCollisionFree(previous, sample, limits.minClearanceM())) {
                throw new BordeauxRuntimeException("Generated trajectory is not collision free");
            }
            canonicalSamples.add(withDynamics(
                    sample, speed, acceleration, angularVelocity, curvature, travelHeading));
            previousVelocityX = velocityX;
            previousVelocityY = velocityY;
            previousSpeed = speed;
            previousAngularVelocity = angularVelocity;
            if (speed > EPSILON) previousTravelHeading = travelHeading;
            if (segmentDistanceM > EPSILON) previousSegmentDistanceM = segmentDistanceM;
        }
        BordeauxSample last = samples.get(samples.size() - 1);
        if (last.timeS() > limits.maxDurationS() + EPSILON || Math.abs(last.fraction() - 1) > EPSILON) {
            throw new BordeauxRuntimeException("Generated trajectory duration or final fraction is invalid");
        }
        return List.copyOf(canonicalSamples);
    }

    private static BordeauxSample withDynamics(BordeauxSample sample, double velocityMps,
            double accelerationMps2, double angularVelocityRadps, double curvatureInvM,
            double travelHeadingRad) {
        return new BordeauxSample(sample.index(), sample.timeS(), sample.distanceM(), sample.fraction(),
                sample.xM(), sample.yM(), sample.headingRad(), velocityMps,
                accelerationMps2, angularVelocityRadps, curvatureInvM, travelHeadingRad);
    }

    private static boolean finite(BordeauxSample value) {
        return Double.isFinite(value.timeS()) && Double.isFinite(value.distanceM())
                && Double.isFinite(value.fraction()) && Double.isFinite(value.xM())
                && Double.isFinite(value.yM()) && Double.isFinite(value.headingRad())
                && Double.isFinite(value.velocityMps()) && Double.isFinite(value.accelerationMps2())
                && Double.isFinite(value.angularVelocityRadps()) && Double.isFinite(value.curvatureInvM())
                && Double.isFinite(value.travelHeadingRad());
    }

    private static double angleDifference(double current, double previous) {
        return Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
    }

    private double now() {
        double value = clock.getAsDouble();
        if (!Double.isFinite(value)) throw new BordeauxRuntimeException("Generated trajectory clock must be finite");
        return value;
    }

    @Override
    public void close() {
        if (active != null) active.cancel();
        active = null;
    }

    private final class Attempt {
        private final BordeauxRoutineNode.GeneratedTrajectory node;
        private final BordeauxGenerationContext context;
        private final BordeauxTrajectoryGeneratorLimits limits;
        private final double deadlineS;
        private volatile Completion completion;
        private Thread thread;

        private Attempt(BordeauxRoutineNode.GeneratedTrajectory node, BordeauxGenerationContext context,
                BordeauxTrajectoryGeneratorLimits limits, double deadlineS) {
            this.node = node;
            this.context = context;
            this.limits = limits;
            this.deadlineS = deadlineS;
        }

        private Attempt(BordeauxRoutineNode.GeneratedTrajectory node) {
            this.node = node;
            this.context = null;
            this.limits = null;
            this.deadlineS = 0;
            this.completion = new Completion(null, 0);
        }

        private void start() {
            thread = new Thread(() -> {
                List<BordeauxSample> samples = null;
                try {
                    samples = validate(generators.invokeRaw(node.generatorId(), context, node.arguments()), context, limits);
                } catch (Throwable ignored) {
                    // The caller receives only a bounded failure state; team errors never cross the robot loop.
                }
                double completedAtS;
                try {
                    completedAtS = now();
                } catch (RuntimeException failure) {
                    completedAtS = Double.POSITIVE_INFINITY;
                    samples = null;
                }
                completion = new Completion(samples, completedAtS);
            }, "bordeaux-trajectory-generator");
            thread.setDaemon(true);
            thread.start();
        }

        private void cancel() {
            if (thread != null) thread.interrupt();
        }
    }

    private record Completion(List<BordeauxSample> samples, double completedAtS) {}
}
