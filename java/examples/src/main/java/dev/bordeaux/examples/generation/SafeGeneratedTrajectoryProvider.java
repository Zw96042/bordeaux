package dev.bordeaux.examples.generation;

import dev.bordeaux.annotations.BordeauxParam;
import dev.bordeaux.annotations.BordeauxTrajectoryFallbackPolicy;
import dev.bordeaux.annotations.BordeauxTrajectoryGenerator;
import dev.bordeaux.annotations.BordeauxTrajectoryPreview;
import dev.bordeaux.runtime.BordeauxGeneratedTrajectory;
import dev.bordeaux.runtime.BordeauxGenerationContext;
import dev.bordeaux.runtime.BordeauxSample;
import java.util.List;

/** Minimal runtime path generator whose complete result is still contained by Bordeaux. */
public final class SafeGeneratedTrajectoryProvider {
    private static final double STOPPED_EPSILON = 1e-3;
    private static final double BRAKE_DURATION_S = 0.05;
    private static final double TIMING_MARGIN = 1.1;

    @BordeauxTrajectoryGenerator(
            id = "paths.forward",
            label = "Generate forward path",
            description = "Creates a bounded straight path from the fused robot pose",
            preview = BordeauxTrajectoryPreview.RUNTIME_DYNAMIC,
            fallbackPolicy = BordeauxTrajectoryFallbackPolicy.SAFE_STOP_ONLY,
            timeoutMs = 40,
            maxSamples = 16,
            maxDurationS = 4,
            maxDistanceM = 2,
            maxVelocityMps = 2,
            maxAccelerationMps2 = 2,
            maxCentripetalAccelerationMps2 = 2,
            maxAngularVelocityRadps = 4,
            maxAngularAccelerationRadps2 = 8,
            minClearanceM = 0.2)
    public BordeauxGeneratedTrajectory forward(
            BordeauxGenerationContext context,
            @BordeauxParam(label = "Distance", unit = "m", min = "0.1", max = "2")
                    double distanceM) {
        if (Math.hypot(context.velocityXMps(), context.velocityYMps()) > STOPPED_EPSILON
                || Math.abs(context.angularVelocityRadps()) > STOPPED_EPSILON) {
            throw new IllegalStateException("This introductory generator requires the robot to be stopped");
        }

        double heading = context.headingRad();
        double brakeX = context.xM() + context.velocityXMps() * BRAKE_DURATION_S * 0.5;
        double brakeY = context.yM() + context.velocityYMps() * BRAKE_DURATION_S * 0.5;
        double brakeHeading = heading + context.angularVelocityRadps() * BRAKE_DURATION_S * 0.5;
        double brakeDistanceM = Math.hypot(brakeX - context.xM(), brakeY - context.yM());
        double forwardDistanceM = distanceM - brakeDistanceM;
        double durationS = TIMING_MARGIN * Math.max(distanceM, Math.sqrt(2 * distanceM));
        double middleX = brakeX + forwardDistanceM * 0.5 * Math.cos(brakeHeading);
        double middleY = brakeY + forwardDistanceM * 0.5 * Math.sin(brakeHeading);
        double endX = brakeX + forwardDistanceM * Math.cos(brakeHeading);
        double endY = brakeY + forwardDistanceM * Math.sin(brakeHeading);
        return new BordeauxGeneratedTrajectory(List.of(
                new BordeauxSample(0, 0, 0, 0,
                        context.xM(), context.yM(), heading, 0, 0, 0, 0, heading),
                new BordeauxSample(1, BRAKE_DURATION_S, brakeDistanceM, brakeDistanceM / distanceM,
                        brakeX, brakeY, brakeHeading, 0, 0, 0, 0, brakeHeading),
                new BordeauxSample(2, BRAKE_DURATION_S + durationS * 0.5,
                        brakeDistanceM + forwardDistanceM * 0.5,
                        (brakeDistanceM + forwardDistanceM * 0.5) / distanceM,
                        middleX, middleY, brakeHeading, 0, 0, 0, 0, brakeHeading),
                new BordeauxSample(3, BRAKE_DURATION_S + durationS, distanceM, 1,
                        endX, endY, brakeHeading, 0, 0, 0, 0, brakeHeading)));
    }
}
