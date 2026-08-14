package dev.bordeaux.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Marks a robot-owned boolean predicate Bordeaux may use for a decision or event marker. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
public @interface BordeauxCondition {
    /** Stable deployed identifier. Defaults to {@code fully.qualified.Provider#method}. */
    String id() default "";

    String label() default "";

    String description() default "";

    String[] aliases() default {};

    String[] semanticTags() default {};
}
