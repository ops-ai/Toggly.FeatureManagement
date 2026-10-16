package io.toggly.spring.boot;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Runtime annotation to guard method execution based on feature flags.
 *
 * <p>Use with {@link FeatureAspect} to enable AOP-based feature gating:</p>
 * <pre>{@code
 * @Service
 * public class MyService {
 *
 *     @FeatureEnabled("new-algorithm")
 *     public Result computeNew() {
 *         // Only executed if feature is enabled
 *     }
 *
 *     @FeatureEnabled(value = "new-algorithm", fallbackMethod = "computeOld")
 *     public Result computeWithFallback() {
 *         // Falls back to computeOld() if disabled
 *     }
 *
 *     public Result computeOld() {
 *         return oldAlgorithm();
 *     }
 * }
 * }</pre>
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface FeatureEnabled {

    /**
     * The feature key(s) to check.
     *
     * @return the feature keys
     */
    String[] value();

    /**
     * Whether ALL features must be enabled (default) or just ANY.
     *
     * @return true if all features must be enabled
     */
    boolean matchAll() default true;

    /**
     * Method name to call when feature is disabled.
     * Must have the same signature as the annotated method.
     *
     * @return fallback method name
     */
    String fallbackMethod() default "";

    /**
     * Value to return when disabled and no fallback is specified.
     * For methods returning boolean, will be parsed as boolean.
     * For methods returning other types, returns null if empty.
     *
     * @return default return value as string
     */
    String defaultValue() default "";
}
