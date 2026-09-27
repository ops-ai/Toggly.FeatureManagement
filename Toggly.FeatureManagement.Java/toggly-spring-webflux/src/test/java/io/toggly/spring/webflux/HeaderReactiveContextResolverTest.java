package io.toggly.spring.webflux;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.test.StepVerifier;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class HeaderReactiveContextResolverTest {

    @Test
    void returnsEmptyContextWhenNoConfiguredHeadersArePresent() {
        HeaderReactiveContextResolver resolver = new HeaderReactiveContextResolver();

        StepVerifier.create(resolver.resolve(exchange("/flags", new HttpHeaders())))
                .assertNext(context -> {
                    assertNull(context.getIdentity());
                    assertEquals(Set.of(), context.getGroups());
                })
                .verifyComplete();
    }

    @Test
    void readsIdentityAndTrimsDuplicateGroups() {
        HttpHeaders headers = new HttpHeaders();
        headers.add("X-User-Id", "alex");
        headers.add("X-User-Groups", " beta, admins, beta,  ");

        StepVerifier.create(new HeaderReactiveContextResolver().resolve(exchange("/flags", headers)))
                .assertNext(context -> {
                    assertEquals("alex", context.getIdentity());
                    assertEquals(Set.of("beta", "admins"), context.getGroups());
                })
                .verifyComplete();
    }

    @Test
    void honorsCustomHeaderNamesAndIgnoresEmptyValues() {
        HttpHeaders headers = new HttpHeaders();
        headers.add("X-Identity", "");
        headers.add("X-Groups", " ");
        HeaderReactiveContextResolver resolver =
                new HeaderReactiveContextResolver("X-Identity", "X-Groups");

        StepVerifier.create(resolver.resolve(exchange("/flags", headers)))
                .assertNext(context -> {
                    assertNull(context.getIdentity());
                    assertEquals(Set.of(), context.getGroups());
                })
                .verifyComplete();
    }

    private static MockServerWebExchange exchange(String path, HttpHeaders headers) {
        return MockServerWebExchange.from(MockServerHttpRequest.get(path).headers(headers));
    }
}
