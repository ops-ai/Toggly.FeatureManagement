package io.toggly.spring.webflux;

import io.toggly.core.context.EvaluationContext;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Function;

/**
 * Reactive context resolver that extracts identity from Spring Security context.
 *
 * <p>Works with any reactive authentication framework.</p>
 */
public class SecurityReactiveContextResolver implements ReactiveContextResolver {

    private final Function<Principal, Set<String>> groupsExtractor;

    /**
     * Creates a resolver that only extracts identity (no groups).
     */
    public SecurityReactiveContextResolver() {
        this(null);
    }

    /**
     * Creates a resolver with a custom groups extractor.
     *
     * @param groupsExtractor function to extract groups from the principal
     */
    public SecurityReactiveContextResolver(Function<Principal, Set<String>> groupsExtractor) {
        this.groupsExtractor = groupsExtractor;
    }

    @Override
    public Mono<EvaluationContext> resolve(ServerWebExchange exchange) {
        return exchange.getPrincipal()
                .map(this::buildContext)
                .defaultIfEmpty(EvaluationContext.empty());
    }

    private EvaluationContext buildContext(Principal principal) {
        EvaluationContext.Builder builder = EvaluationContext.builder()
                .identity(principal.getName());

        if (groupsExtractor != null) {
            Set<String> groups = groupsExtractor.apply(principal);
            if (groups != null && !groups.isEmpty()) {
                builder.groups(groups);
            }
        }

        return builder.build();
    }

    /**
     * Creates a resolver for Spring Security WebFlux with role extraction.
     *
     * @return the resolver
     */
    public static SecurityReactiveContextResolver forSpringSecurityRoles() {
        return new SecurityReactiveContextResolver(principal -> {
            Set<String> roles = new HashSet<>();
            try {
                Class<?> authClass = Class.forName(
                        "org.springframework.security.core.Authentication");
                if (authClass.isInstance(principal)) {
                    Object authorities = authClass.getMethod("getAuthorities")
                            .invoke(principal);
                    if (authorities instanceof Collection) {
                        for (Object authority : (Collection<?>) authorities) {
                            Object roleStr = authority.getClass()
                                    .getMethod("getAuthority").invoke(authority);
                            if (roleStr != null) {
                                roles.add(roleStr.toString());
                            }
                        }
                    }
                }
            } catch (Exception e) {
                // Spring Security not available
            }
            return roles;
        });
    }
}
