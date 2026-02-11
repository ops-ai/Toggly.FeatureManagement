package io.toggly.spring.webflux;

import io.toggly.core.context.EvaluationContext;
import org.springframework.http.HttpHeaders;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Reactive context resolver that extracts identity and groups from HTTP headers.
 *
 * <p>Default headers:</p>
 * <ul>
 *     <li>{@code X-User-Id} - User identity</li>
 *     <li>{@code X-User-Groups} - Comma-separated groups</li>
 * </ul>
 */
public class HeaderReactiveContextResolver implements ReactiveContextResolver {

    private final String identityHeader;
    private final String groupsHeader;

    /**
     * Creates a resolver with default headers.
     */
    public HeaderReactiveContextResolver() {
        this("X-User-Id", "X-User-Groups");
    }

    /**
     * Creates a resolver with custom headers.
     *
     * @param identityHeader header name for user identity
     * @param groupsHeader header name for groups (comma-separated)
     */
    public HeaderReactiveContextResolver(String identityHeader, String groupsHeader) {
        this.identityHeader = identityHeader;
        this.groupsHeader = groupsHeader;
    }

    @Override
    public Mono<EvaluationContext> resolve(ServerWebExchange exchange) {
        HttpHeaders headers = exchange.getRequest().getHeaders();
        String identity = headers.getFirst(identityHeader);
        String groupsStr = headers.getFirst(groupsHeader);

        if (identity == null && groupsStr == null) {
            return Mono.just(EvaluationContext.empty());
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

        return Mono.just(builder.build());
    }
}
