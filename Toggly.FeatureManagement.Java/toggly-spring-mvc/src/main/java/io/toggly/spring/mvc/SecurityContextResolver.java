package io.toggly.spring.mvc;

import io.toggly.core.context.EvaluationContext;
import jakarta.servlet.http.HttpServletRequest;

import java.security.Principal;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Function;

/**
 * Context resolver that extracts identity from Spring Security context.
 *
 * <p>Works with any authentication framework that provides a {@link Principal}.</p>
 *
 * <p>For Spring Security with roles:</p>
 * <pre>{@code
 * new SecurityContextResolver(auth -> {
 *     if (auth instanceof Authentication) {
 *         return ((Authentication) auth).getAuthorities().stream()
 *             .map(GrantedAuthority::getAuthority)
 *             .collect(Collectors.toSet());
 *     }
 *     return Set.of();
 * });
 * }</pre>
 */
public class SecurityContextResolver implements ContextResolver {

    private final Function<Principal, Set<String>> groupsExtractor;

    /**
     * Creates a resolver that only extracts identity (no groups).
     */
    public SecurityContextResolver() {
        this(null);
    }

    /**
     * Creates a resolver with a custom groups extractor.
     *
     * @param groupsExtractor function to extract groups from the principal
     */
    public SecurityContextResolver(Function<Principal, Set<String>> groupsExtractor) {
        this.groupsExtractor = groupsExtractor;
    }

    @Override
    public EvaluationContext resolve(HttpServletRequest request) {
        Principal principal = request.getUserPrincipal();

        if (principal == null) {
            return EvaluationContext.empty();
        }

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
     * Creates a resolver for Spring Security with role extraction.
     *
     * <p>Extracts roles from {@code Authentication.getAuthorities()}.</p>
     *
     * @return the resolver
     */
    public static SecurityContextResolver forSpringSecurityRoles() {
        return new SecurityContextResolver(principal -> {
            Set<String> roles = new HashSet<>();
            try {
                // Use reflection to avoid compile-time dependency on Spring Security
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
                // Spring Security not available or incompatible version
            }
            return roles;
        });
    }
}
