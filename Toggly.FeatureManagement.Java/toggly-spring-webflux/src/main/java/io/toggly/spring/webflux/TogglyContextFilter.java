package io.toggly.spring.webflux;

import io.toggly.core.context.EvaluationContext;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * WebFilter that sets up the evaluation context for each request.
 *
 * <p>Stores the context in the Reactor context for downstream subscribers.</p>
 *
 * <p>Register as a bean:</p>
 * <pre>{@code
 * @Bean
 * public TogglyContextFilter togglyContextFilter() {
 *     return new TogglyContextFilter(new HeaderReactiveContextResolver());
 * }
 * }</pre>
 */
public class TogglyContextFilter implements WebFilter {

    /**
     * Key for storing evaluation context in Reactor context.
     */
    public static final String CONTEXT_KEY = EvaluationContext.class.getName();

    private final ReactiveContextResolver contextResolver;

    /**
     * Creates a filter with a context resolver.
     *
     * @param contextResolver the resolver to extract context from exchanges
     */
    public TogglyContextFilter(ReactiveContextResolver contextResolver) {
        this.contextResolver = contextResolver;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        if (contextResolver == null) {
            return chain.filter(exchange);
        }

        return contextResolver.resolve(exchange)
                .flatMap(context -> chain.filter(exchange)
                        .contextWrite(ctx -> ctx.put(CONTEXT_KEY, context)));
    }

    /**
     * Retrieves the evaluation context from the Reactor context.
     *
     * @return Mono emitting the context or empty context if not set
     */
    public static Mono<EvaluationContext> getContext() {
        return Mono.deferContextual(ctx ->
                Mono.justOrEmpty(ctx.getOrEmpty(CONTEXT_KEY))
                        .map(obj -> (EvaluationContext) obj)
                        .defaultIfEmpty(EvaluationContext.empty()));
    }
}
