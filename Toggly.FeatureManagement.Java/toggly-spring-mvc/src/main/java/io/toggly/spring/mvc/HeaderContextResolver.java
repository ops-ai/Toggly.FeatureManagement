package io.toggly.spring.mvc;

import io.toggly.core.context.EvaluationContext;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Context resolver that extracts identity and groups from HTTP headers.
 *
 * <p>Default headers:</p>
 * <ul>
 *     <li>{@code X-User-Id} - User identity</li>
 *     <li>{@code X-User-Groups} - Comma-separated groups</li>
 * </ul>
 */
public class HeaderContextResolver implements ContextResolver {

    private final String identityHeader;
    private final String groupsHeader;

    /**
     * Creates a resolver with default headers.
     */
    public HeaderContextResolver() {
        this("X-User-Id", "X-User-Groups");
    }

    /**
     * Creates a resolver with custom headers.
     *
     * @param identityHeader header name for user identity
     * @param groupsHeader header name for groups (comma-separated)
     */
    public HeaderContextResolver(String identityHeader, String groupsHeader) {
        this.identityHeader = identityHeader;
        this.groupsHeader = groupsHeader;
    }

    @Override
    public EvaluationContext resolve(HttpServletRequest request) {
        String identity = request.getHeader(identityHeader);
        String groupsStr = request.getHeader(groupsHeader);

        if (identity == null && groupsStr == null) {
            return EvaluationContext.empty();
        }

        EvaluationContext.Builder builder = EvaluationContext.builder();

        if (identity != null && !identity.isEmpty()) {
            builder.identity(identity);
        }

        if (groupsStr != null && !groupsStr.isEmpty()) {
            Set<String> groups = new HashSet<>();
            Arrays.stream(groupsStr.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(groups::add);
            builder.groups(groups);
        }

        return builder.build();
    }
}
