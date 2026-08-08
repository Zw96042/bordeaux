package dev.bordeaux.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Adds editor metadata to an authored command-factory parameter. */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.SOURCE)
public @interface BordeauxParam {
    String label() default "";

    String description() default "";

    String unit() default "";

    /** JSON text used as the editor default. Empty means no explicit default. */
    String defaultValue() default "";

    /** Optional exact decimal lower bound. */
    String min() default "";

    /** Optional exact decimal upper bound. */
    String max() default "";
}
