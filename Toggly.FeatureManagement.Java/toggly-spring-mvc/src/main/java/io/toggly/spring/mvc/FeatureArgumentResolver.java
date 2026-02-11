package io.toggly.spring.mvc;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Argument resolver for injecting feature flag state into controller methods.
 *
 * <p>Usage:</p>
 * <pre>{@code
 * @GetMapping("/dashboard")
 * public String dashboard(@FeatureFlag("new-dashboard") boolean newDashboard) {
 *     if (newDashboard) {
 *         return "dashboard-v2";
 *     }
 *     return "dashboard-v1";
 * }
 * }</pre>
 *
 * <p>Register in your Spring MVC configuration:</p>
 * <pre>{@code
 * @Configuration
 * public class WebConfig implements WebMvcConfigurer {
 *     @Autowired
 *     private TogglyClient togglyClient;
 *
 *     @Override
 *     public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
 *         resolvers.add(new FeatureArgumentResolver(togglyClient));
 *     }
 * }
 * }</pre>
 */
public class FeatureArgumentResolver implements HandlerMethodArgumentResolver {

    private final TogglyClient togglyClient;

    public FeatureArgumentResolver(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(FeatureFlag.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
        FeatureFlag annotation = parameter.getParameterAnnotation(FeatureFlag.class);
        if (annotation == null) {
            return null;
        }

        String featureKey = annotation.value();
        boolean enabled = togglyClient.isEnabled(featureKey, ContextHolder.getContext());

        Class<?> paramType = parameter.getParameterType();
        if (paramType == boolean.class || paramType == Boolean.class) {
            return enabled;
        }

        throw new IllegalArgumentException(
                "@FeatureFlag parameter must be boolean, found: " + paramType.getName());
    }

    /**
     * Annotation to inject feature flag state into controller parameters.
     */
    @Target(ElementType.PARAMETER)
    @Retention(RetentionPolicy.RUNTIME)
    @Documented
    public @interface FeatureFlag {
        /**
         * The feature key to check.
         *
         * @return the feature key
         */
        String value();
    }
}
