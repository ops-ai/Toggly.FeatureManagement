package io.toggly.hosts.webflux;

import io.toggly.spring.webflux.SecurityReactiveContextResolver;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

import java.util.Arrays;
import java.util.Collection;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;

class WebFluxHostTest {

    @Test
    void packagedResolverIgnoresNullAuthoritiesAndKeepsValidRoles() {
        Authentication authentication = new Authentication() {
            @Override
            public Collection<? extends GrantedAuthority> getAuthorities() {
                return Arrays.asList(null, new SimpleGrantedAuthority("ROLE_USER"));
            }

            @Override
            public Object getCredentials() {
                return null;
            }

            @Override
            public Object getDetails() {
                return null;
            }

            @Override
            public Object getPrincipal() {
                return "host-user";
            }

            @Override
            public boolean isAuthenticated() {
                return true;
            }

            @Override
            public void setAuthenticated(boolean authenticated) {
            }

            @Override
            public String getName() {
                return "host-user";
            }
        };
        MockServerWebExchange exchange = MockServerWebExchange.builder(
                        MockServerHttpRequest.get("/flags").build())
                .principal(authentication)
                .build();

        assertEquals(Set.of("ROLE_USER"), SecurityReactiveContextResolver.forSpringSecurityRoles()
                .resolve(exchange)
                .block()
                .getGroups());
    }
}
