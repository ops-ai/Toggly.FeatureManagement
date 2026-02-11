package io.toggly.spring.mvc;

import io.toggly.core.context.ContextHolder;
import io.toggly.core.context.EvaluationContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Interceptor that sets up the evaluation context for each request.
 *
 * <p>Use with a {@link ContextResolver} to extract identity information
 * from the request (e.g., from headers, session, or authentication).</p>
 *
 * <p>Register in your Spring MVC configuration:</p>
 * <pre>{@code
 * @Configuration
 * public class WebConfig implements WebMvcConfigurer {
 *     @Override
 *     public void addInterceptors(InterceptorRegistry registry) {
 *         registry.addInterceptor(new TogglyContextInterceptor(
 *             new HeaderContextResolver("X-User-Id", "X-User-Groups")
 *         ));
 *     }
 * }
 * }</pre>
 */
public class TogglyContextInterceptor implements HandlerInterceptor {

    private final ContextResolver contextResolver;

    /**
     * Creates an interceptor with a context resolver.
     *
     * @param contextResolver the resolver to extract context from requests
     */
    public TogglyContextInterceptor(ContextResolver contextResolver) {
        this.contextResolver = contextResolver;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        EvaluationContext context = contextResolver != null
                ? contextResolver.resolve(request)
                : EvaluationContext.empty();

        ContextHolder.setContext(context);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        ContextHolder.clear();
    }
}
