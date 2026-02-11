package io.toggly.spring.mvc;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.ContextHolder;
import io.toggly.core.model.FeatureRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Arrays;

/**
 * Interceptor that enforces {@link FeatureGate} annotations.
 *
 * <p>Register in your Spring MVC configuration after the context interceptor:</p>
 * <pre>{@code
 * @Configuration
 * public class WebConfig implements WebMvcConfigurer {
 *     @Autowired
 *     private TogglyClient togglyClient;
 *
 *     @Override
 *     public void addInterceptors(InterceptorRegistry registry) {
 *         registry.addInterceptor(new TogglyContextInterceptor(...));
 *         registry.addInterceptor(new FeatureGateInterceptor(togglyClient));
 *     }
 * }
 * }</pre>
 */
public class FeatureGateInterceptor implements HandlerInterceptor {

    private final TogglyClient togglyClient;

    /**
     * Creates an interceptor with the Toggly client.
     *
     * @param togglyClient the Toggly client
     */
    public FeatureGateInterceptor(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) throws Exception {
        if (!(handler instanceof HandlerMethod)) {
            return true;
        }

        HandlerMethod handlerMethod = (HandlerMethod) handler;

        // Check method-level annotation
        FeatureGate methodGate = handlerMethod.getMethodAnnotation(FeatureGate.class);
        if (methodGate != null && !checkGate(methodGate)) {
            response.sendError(methodGate.status());
            return false;
        }

        // Check class-level annotation
        FeatureGate classGate = handlerMethod.getBeanType().getAnnotation(FeatureGate.class);
        if (classGate != null && !checkGate(classGate)) {
            response.sendError(classGate.status());
            return false;
        }

        return true;
    }

    private boolean checkGate(FeatureGate gate) {
        FeatureRequirement requirement = gate.matchAll()
                ? FeatureRequirement.ALL
                : FeatureRequirement.ANY;

        return togglyClient.gate(
                Arrays.asList(gate.value()),
                requirement,
                gate.negate(),
                ContextHolder.getContext());
    }
}
