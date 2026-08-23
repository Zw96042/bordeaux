package dev.bordeaux.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a robot-owned command factory or existing command as an action Bordeaux may run.
 *
 * <p>Fields must be public and final, and must contain either a WPILib {@code Command} or a
 * {@code Supplier<? extends Command>}. A command field reuses one WPILib lifecycle and is appropriate
 * only when ownership is mutually exclusive; a supplier creates a command for each invocation.
 */
@Target({ElementType.METHOD, ElementType.FIELD})
@Retention(RetentionPolicy.SOURCE)
public @interface BordeauxCommand {
    /** Stable deployed identifier. Defaults to {@code fully.qualified.Provider#member}. */
    String id() default "";

    String label() default "";

    String description() default "";

    /** Bounded phrases agents may use to identify this exact team action. */
    String[] aliases() default {};

    /** Stable capabilities such as {@code shoot-fuel}; use lowercase kebab case. */
    String[] semanticTags() default {};
}
