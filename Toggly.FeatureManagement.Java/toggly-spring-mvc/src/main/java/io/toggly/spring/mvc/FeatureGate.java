package io.toggly.spring.mvc;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Annotation to gate controller methods or classes based on feature flags.
 *
 * <p>Use on controllers or handler methods to restrict access based on features:</p>
 * <pre>{@code
 * @RestController
 * @RequestMapping("/api/v2/checkout")
 * @FeatureGate("new-checkout-api")
 * public class NewCheckoutController {
 *     // All endpoints require the feature to be enabled
 * }
 *
 * @RestController
 * public class MyController {
 *
 *     @GetMapping("/beta-feature")
 *     @FeatureGate("beta-feature")
 *     public ResponseEntity<String> betaFeature() {
 *         return ResponseEntity.ok("Beta feature!");
 *     }
 * }
 * }</pre>
 *
 * <p>When a feature is disabled, returns HTTP 404 by default.
 * Use {@link #status()} to customize the response status.</p>
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface FeatureGate {

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
     * Whether to negate the condition (gate if feature IS enabled).
     *
     * @return true to gate when enabled
     */
    boolean negate() default false;

    /**
     * HTTP status code to return when the gate blocks the request.
     * Defaults to 404 (Not Found).
     *
     * @return the HTTP status code
     */
    int status() default 404;
}
