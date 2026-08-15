package dev.bordeaux.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Declares one bounded robot-owned runtime trajectory generator. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
public @interface BordeauxTrajectoryGenerator {
    String id() default "";
    String label() default "";
    String description() default "";
    String[] aliases() default {};
    String[] semanticTags() default {};

    BordeauxTrajectoryPreview preview() default BordeauxTrajectoryPreview.UNSPECIFIED;
    BordeauxTrajectoryFallbackPolicy fallbackPolicy() default BordeauxTrajectoryFallbackPolicy.UNSPECIFIED;
    int timeoutMs() default -1;
    int maxSamples() default -1;
    double maxDurationS() default -1;
    double maxDistanceM() default -1;
    double maxVelocityMps() default -1;
    double maxAccelerationMps2() default -1;
    double maxCentripetalAccelerationMps2() default -1;
    double maxAngularVelocityRadps() default -1;
    double maxAngularAccelerationRadps2() default -1;
    double minClearanceM() default -1;
}
