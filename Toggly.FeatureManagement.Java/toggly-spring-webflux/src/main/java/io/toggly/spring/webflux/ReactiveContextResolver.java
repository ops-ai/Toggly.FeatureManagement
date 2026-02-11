package io.toggly.spring.webflux;

import io.toggly.core.context.EvaluationContext;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Interface for resolving evaluation context from reactive web exchanges.
 */
@FunctionalInterface
public interface ReactiveContextResolver {

    /**
     * Resolves the evaluation context from a server web exchange.
     *
     * @param exchange the server web exchange
     * @return a Mono emitting the evaluation context
     */
    Mono<EvaluationContext> resolve(ServerWebExchange exchange);
}
