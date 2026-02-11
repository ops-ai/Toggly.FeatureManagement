package io.toggly.spring.boot;

import org.springframework.context.annotation.Conditional;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Conditional annotation that checks if a feature flag is enabled.
 *
 * <p>Use on {@code @Bean} methods or {@code @Configuration} classes:</p>
 * <pre>{@code
 * @Bean
 * @ConditionalOnFeature("new-checkout-flow")
 * public CheckoutService checkoutService() {
 *     return new NewCheckoutService();
 * }
 * }</pre>
 *
 * <p>Note: This condition is evaluated at bean creation time (startup),
 * not at runtime. For runtime feature evaluation, use {@link TogglyClient}.</p>
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Conditional(OnFeatureCondition.class)
public @interface ConditionalOnFeature {

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
     * Whether to negate the condition (match if feature is disabled).
     *
     * @return true to match when disabled
     */
    boolean matchIfDisabled() default false;
}
