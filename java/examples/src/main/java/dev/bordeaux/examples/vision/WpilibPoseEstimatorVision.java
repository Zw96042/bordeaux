package dev.bordeaux.examples.vision;

import dev.bordeaux.runtime.BordeauxVisionObservation;
import edu.wpi.first.math.VecBuilder;
import edu.wpi.first.math.estimator.SwerveDrivePoseEstimator;
import java.util.Objects;
import java.util.function.Consumer;

/** Converts Bordeaux's normalized camera measurement into WPILib's Kalman pose estimator input. */
public final class WpilibPoseEstimatorVision {
    private WpilibPoseEstimatorVision() {}

    public static Consumer<BordeauxVisionObservation> consumer(SwerveDrivePoseEstimator estimator) {
        Objects.requireNonNull(estimator, "estimator");
        return observation -> estimator.addVisionMeasurement(
                observation.fieldPose(),
                observation.captureTimestampS(),
                VecBuilder.fill(
                        observation.xStdDevM(),
                        observation.yStdDevM(),
                        observation.headingStdDevRad()));
    }
}
