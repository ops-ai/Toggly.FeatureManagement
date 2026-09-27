package io.toggly.spring.webflux;

import io.toggly.core.context.EvaluationContext;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class TogglyContextFilterTest {

    @Test
    void leavesChainContextUntouchedWhenNoResolverIsConfigured() {
        AtomicReference<EvaluationContext> observed = new AtomicReference<>();
        WebFilterChain chain = ignored -> TogglyContextFilter.getContext()
                .doOnNext(observed::set)
                .then();

        StepVerifier.create(new TogglyContextFilter(null).filter(exchange(), chain))
                .verifyComplete();

        assertNull(observed.get().getIdentity());
    }

    @Test
    void writesResolvedContextForDownstreamSubscribers() {
        EvaluationContext expected = EvaluationContext.forIdentity("alex");
        AtomicReference<EvaluationContext> observed = new AtomicReference<>();
        WebFilterChain chain = ignored -> TogglyContextFilter.getContext()
                .doOnNext(observed::set)
                .then();

        StepVerifier.create(new TogglyContextFilter(ignored -> Mono.just(expected)).filter(exchange(), chain))
                .verifyComplete();

        assertEquals(expected, observed.get());
    }

    @Test
    void readsExistingReactorContextAndFallsBackToEmptyContext() {
        EvaluationContext expected = EvaluationContext.forIdentity("alex");

        StepVerifier.create(TogglyContextFilter.getContext()
                        .contextWrite(context -> context.put(TogglyContextFilter.CONTEXT_KEY, expected)))
                .expectNext(expected)
                .verifyComplete();
        StepVerifier.create(TogglyContextFilter.getContext())
                .assertNext(context -> assertNull(context.getIdentity()))
                .verifyComplete();
    }

    private static MockServerWebExchange exchange() {
        return MockServerWebExchange.from(MockServerHttpRequest.get("/flags").build());
    }
}
