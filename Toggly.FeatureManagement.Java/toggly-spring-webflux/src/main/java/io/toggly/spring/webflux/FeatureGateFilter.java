package io.toggly.spring.webflux;

import io.toggly.core.TogglyClient;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureRequirement;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.function.Predicate;

/**
 * WebFilter that gates routes based on feature flags.
 *
 * <p>Use with route matchers to gate specific endpoints:</p>
 * <pre>{@code
 * @Bean
 * public FeatureGateFilter betaApiFilter(TogglyClient client) {
 *     return FeatureGateFilter.builder(client)
 *         .features("beta-api")
 *         .pathPattern("/api/v2/**")
 *         .build();
 * }
 * }</pre>
 */
public class FeatureGateFilter implements WebFilter {

    private final TogglyClient client;
    private final List<String> features;
    private final FeatureRequirement requirement;
    private final boolean negate;
    private final HttpStatus blockedStatus;
    private final Predicate<ServerWebExchange> pathMatcher;

    private FeatureGateFilter(Builder builder) {
        this.client = builder.client;
        this.features = builder.features;
        this.requirement = builder.requirement;
        this.negate = builder.negate;
        this.blockedStatus = builder.blockedStatus;
        this.pathMatcher = builder.pathMatcher;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        if (pathMatcher != null && !pathMatcher.test(exchange)) {
            return chain.filter(exchange);
        }

        return TogglyContextFilter.getContext()
                .flatMap(context -> {
                    boolean allowed = checkGate(context);
                    if (allowed) {
                        return chain.filter(exchange);
                    }
                    exchange.getResponse().setStatusCode(blockedStatus);
                    return exchange.getResponse().setComplete();
                });
    }

    private boolean checkGate(EvaluationContext context) {
        return client.gate(features, requirement, negate, context);
    }

    /**
     * Creates a builder.
     *
     * @param client the Toggly client
     * @return the builder
     */
    public static Builder builder(TogglyClient client) {
        return new Builder(client);
    }

    /**
     * Builder for FeatureGateFilter.
     */
    public static class Builder {
        private final TogglyClient client;
        private List<String> features = Collections.emptyList();
        private FeatureRequirement requirement = FeatureRequirement.ALL;
        private boolean negate = false;
        private HttpStatus blockedStatus = HttpStatus.NOT_FOUND;
        private Predicate<ServerWebExchange> pathMatcher;

        private Builder(TogglyClient client) {
            this.client = client;
        }

        /**
         * Sets the feature keys to check.
         *
         * @param features the feature keys
         * @return this builder
         */
        public Builder features(String... features) {
            this.features = Arrays.asList(features);
            return this;
        }

        /**
         * Sets the feature keys to check.
         *
         * @param features the feature keys
         * @return this builder
         */
        public Builder features(List<String> features) {
            this.features = features;
            return this;
        }

        /**
         * Requires ALL features to be enabled (default).
         *
         * @return this builder
         */
        public Builder matchAll() {
            this.requirement = FeatureRequirement.ALL;
            return this;
        }

        /**
         * Requires ANY feature to be enabled.
         *
         * @return this builder
         */
        public Builder matchAny() {
            this.requirement = FeatureRequirement.ANY;
            return this;
        }

        /**
         * Negates the result (gate when enabled).
         *
         * @return this builder
         */
        public Builder negate() {
            this.negate = true;
            return this;
        }

        /**
         * Sets the HTTP status when blocked.
         *
         * @param status the status code
         * @return this builder
         */
        public Builder blockedStatus(HttpStatus status) {
            this.blockedStatus = status;
            return this;
        }

        /**
         * Sets a path pattern to match.
         *
         * @param pattern the ant-style path pattern
         * @return this builder
         */
        public Builder pathPattern(String pattern) {
            this.pathMatcher = exchange -> {
                String path = exchange.getRequest().getPath().value();
                return matchesPattern(path, pattern);
            };
            return this;
        }

        /**
         * Sets a custom path matcher.
         *
         * @param matcher the matcher predicate
         * @return this builder
         */
        public Builder pathMatcher(Predicate<ServerWebExchange> matcher) {
            this.pathMatcher = matcher;
            return this;
        }

        /**
         * Builds the filter.
         *
         * @return the filter
         */
        public FeatureGateFilter build() {
            return new FeatureGateFilter(this);
        }

        private boolean matchesPattern(String path, String pattern) {
            // Simple ant-style pattern matching
            if (pattern.equals("/**")) {
                return true;
            }
            if (pattern.endsWith("/**")) {
                String prefix = pattern.substring(0, pattern.length() - 3);
                return path.startsWith(prefix);
            }
            if (pattern.contains("*")) {
                String regex = pattern.replace(".", "\\.")
                        .replace("**", ".*")
                        .replace("*", "[^/]*");
                return path.matches(regex);
            }
            return path.equals(pattern);
        }
    }
}
