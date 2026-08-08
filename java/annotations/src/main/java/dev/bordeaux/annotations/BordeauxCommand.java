package dev.bordeaux.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Marks a robot-owned factory method as an action Bordeaux may place on a path. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
public @interface BordeauxCommand {
    /** Stable deployed identifier. Defaults to {@code fully.qualified.Provider#method}. */
    String id() default "";

    String label() default "";

    String description() default "";

    /** Bounded phrases agents may use to identify this exact team action. */
    String[] aliases() default {};

    /** Stable capabilities such as {@code shoot-fuel}; use lowercase kebab case. */
    String[] semanticTags() default {};
}
