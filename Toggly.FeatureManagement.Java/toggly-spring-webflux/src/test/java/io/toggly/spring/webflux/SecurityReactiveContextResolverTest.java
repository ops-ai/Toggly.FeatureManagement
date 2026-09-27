package io.toggly.spring.webflux;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import reactor.test.StepVerifier;

import java.security.Principal;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SecurityReactiveContextResolverTest {

    @Test
    void returnsEmptyContextWhenExchangeHasNoPrincipal() {
        SecurityReactiveContextResolver resolver = new SecurityReactiveContextResolver();

        StepVerifier.create(resolver.resolve(exchange()))
                .assertNext(context -> assertNull(context.getIdentity()))
                .verifyComplete();
    }

    @Test
    void mapsPrincipalAndCustomGroups() {
        Principal principal = () -> "alex";
        SecurityReactiveContextResolver resolver =
                new SecurityReactiveContextResolver(ignored -> Set.of("admin", "beta"));

        StepVerifier.create(resolver.resolve(exchange(principal)))
                .assertNext(context -> {
                    assertEquals("alex", context.getIdentity());
                    assertEquals(Set.of("admin", "beta"), context.getGroups());
                })
                .verifyComplete();
    }

    @Test
    void ignoresNullGroupsAndSkipsPrincipalsThatAreNotSpringSecurityAuthentication() {
        Principal principal = () -> "alex";

        StepVerifier.create(new SecurityReactiveContextResolver(ignored -> null).resolve(exchange(principal)))
                .assertNext(context -> assertEquals(Set.of(), context.getGroups()))
                .verifyComplete();
        StepVerifier.create(SecurityReactiveContextResolver.forSpringSecurityRoles()
                        .resolve(exchange(principal)))
                .assertNext(context -> assertEquals(Set.of(), context.getGroups()))
                .verifyComplete();
    }

    @Test
    void extractsRolesFromSpringSecurityAuthenticationWithoutRuntimeCoupling() {
        TestingAuthenticationToken authentication = new TestingAuthenticationToken(
                "alex", "ignored", List.of(new SimpleGrantedAuthority("ROLE_ADMIN"),
                        new SimpleGrantedAuthority("ROLE_BETA")));

        StepVerifier.create(SecurityReactiveContextResolver.forSpringSecurityRoles()
                        .resolve(exchange(authentication)))
                .assertNext(context -> {
                    assertEquals("alex", context.getIdentity());
                    assertEquals(Set.of("ROLE_ADMIN", "ROLE_BETA"), context.getGroups());
                })
                .verifyComplete();
    }

    @Test
    void ignoresNullAuthoritiesAndKeepsValidRoles() {
        Authentication authentication = authentication(null, new SimpleGrantedAuthority("ROLE_USER"));

        StepVerifier.create(SecurityReactiveContextResolver.forSpringSecurityRoles()
                        .resolve(exchange(authentication)))
                .assertNext(context -> assertEquals(Set.of("ROLE_USER"), context.getGroups()))
                .verifyComplete();
    }

    @Test
    void preservesRolesReadBeforeMalformedAuthority() {
        Authentication authentication = authentication(
                new SimpleGrantedAuthority("ROLE_ADMIN"), new Object(),
                new SimpleGrantedAuthority("ROLE_LATER"));

        StepVerifier.create(SecurityReactiveContextResolver.forSpringSecurityRoles()
                        .resolve(exchange(authentication)))
                .assertNext(context -> assertEquals(Set.of("ROLE_ADMIN"), context.getGroups()))
                .verifyComplete();
    }

    private static Authentication authentication(Object... authorities) {
        return new Authentication() {
            private boolean authenticated = true;

            @Override
            @SuppressWarnings({"unchecked", "rawtypes"})
            public Collection<? extends GrantedAuthority> getAuthorities() {
                return (Collection) Arrays.asList(authorities);
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
                return "alex";
            }

            @Override
            public boolean isAuthenticated() {
                return authenticated;
            }

            @Override
            public void setAuthenticated(boolean authenticated) {
                this.authenticated = authenticated;
            }

            @Override
            public String getName() {
                return "alex";
            }
        };
    }

    private static MockServerWebExchange exchange() {
        return MockServerWebExchange.from(MockServerHttpRequest.get("/flags").build());
    }

    private static MockServerWebExchange exchange(Principal principal) {
        return MockServerWebExchange.builder(MockServerHttpRequest.get("/flags").build())
                .principal(principal)
                .build();
    }
}
