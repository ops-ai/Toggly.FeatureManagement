package io.toggly.spring.webflux;

import io.toggly.core.TogglyClient;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FeatureGateFilterTest {

    @Test
    void skipsGateOutsideConfiguredPrefix() {
        TogglyClient client = TestTogglyClients.clientWith();
        AtomicBoolean continued = new AtomicBoolean();
        FeatureGateFilter filter = FeatureGateFilter.builder(client)
                .features("beta")
                .pathPattern("/api/**")
                .build();

        StepVerifier.create(filter.filter(exchange("/health"), continueChain(continued))).verifyComplete();

        assertTrue(continued.get());
    }

    @Test
    void allowsMatchingPathWhenConfiguredFeaturesPass() {
        TogglyClient client = TestTogglyClients.clientWith("beta");
        AtomicBoolean continued = new AtomicBoolean();
        FeatureGateFilter filter = FeatureGateFilter.builder(client)
                .features(List.of("beta"))
                .matchAny()
                .pathPattern("/api/*/flags")
                .build();

        StepVerifier.create(filter.filter(exchange("/api/v2/flags"), continueChain(continued))
                        .contextWrite(values -> values.put(TogglyContextFilter.CONTEXT_KEY,
                                TestTogglyClients.context())))
                .verifyComplete();

        assertTrue(continued.get());
    }

    @Test
    void blocksMatchingPathWithConfiguredStatusAndNegation() {
        TogglyClient client = TestTogglyClients.clientWith("beta");
        AtomicBoolean continued = new AtomicBoolean();
        MockServerWebExchange exchange = exchange("/admin");
        FeatureGateFilter filter = FeatureGateFilter.builder(client)
                .features("beta")
                .negate()
                .blockedStatus(HttpStatus.FORBIDDEN)
                .pathPattern("/**")
                .build();

        StepVerifier.create(filter.filter(exchange, continueChain(continued))).verifyComplete();

        assertFalse(continued.get());
        assertEquals(HttpStatus.FORBIDDEN, exchange.getResponse().getStatusCode());
    }

    @Test
    void acceptsCustomPathMatcherAndExactPatterns() {
        TogglyClient client = TestTogglyClients.clientWith("beta");
        AtomicBoolean continued = new AtomicBoolean();

        StepVerifier.create(FeatureGateFilter.builder(client)
                        .features("beta")
                        .pathPattern("/exact")
                        .build()
                        .filter(exchange("/exact"), continueChain(continued)))
                .verifyComplete();
        StepVerifier.create(FeatureGateFilter.builder(client)
                        .features("beta")
                        .pathMatcher(value -> value.getRequest().getPath().value().startsWith("/custom"))
                        .build()
                        .filter(exchange("/custom/flag"), continueChain(continued)))
                .verifyComplete();

        assertTrue(continued.get());
    }

    private static MockServerWebExchange exchange(String path) {
        return MockServerWebExchange.from(MockServerHttpRequest.get(path).build());
    }

    private static WebFilterChain continueChain(AtomicBoolean continued) {
        return ignored -> Mono.fromRunnable(() -> continued.set(true)).then();
    }
}
