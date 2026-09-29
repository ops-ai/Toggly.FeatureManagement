package io.toggly.cache.caffeine;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import io.toggly.core.context.EvaluationContext;

import java.time.Duration;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * Cache for evaluation results to avoid re-evaluating the same feature/context pairs.
 *
 * <p>Useful in high-throughput scenarios where the same features are evaluated
 * many times with the same context.</p>
 *
 * <p>Usage:</p>
 * <pre>{@code
 * CaffeineEvaluationCache evaluationCache = CaffeineEvaluationCache.builder()
 *     .expireAfterWrite(Duration.ofSeconds(10))
 *     .maximumSize(10000)
 *     .build();
 *
 * boolean enabled = evaluationCache.getOrCompute(
 *     "my-feature",
 *     context,
 *     () -> togglyClient.isEnabled("my-feature", context)
 * );
 * }</pre>
 */
public class CaffeineEvaluationCache {

    private final Cache<CacheKey, Boolean> cache;

    private CaffeineEvaluationCache(Cache<CacheKey, Boolean> cache) {
        this.cache = cache;
    }

    /**
     * Gets an evaluation result from cache or computes it.
     *
     * @param featureKey the feature key
     * @param context the evaluation context
     * @param evaluator the function to compute the result if not cached
     * @return the evaluation result
     */
    public boolean getOrCompute(String featureKey, EvaluationContext context, Supplier<Boolean> evaluator) {
        CacheKey key = new CacheKey(featureKey, context);
        Boolean result = cache.get(key, k -> evaluator.get());
        return Boolean.TRUE.equals(result);
    }

    /**
     * Invalidates all cached evaluations for a feature.
     *
     * @param featureKey the feature key
     */
    public void invalidateFeature(String featureKey) {
        cache.asMap().keySet().removeIf(key -> Objects.equals(key.featureKey, featureKey));
    }

    /**
     * Invalidates all cached evaluations.
     */
    public void invalidateAll() {
        cache.invalidateAll();
    }

    /**
     * Gets cache statistics if recording is enabled.
     *
     * @return the cache stats
     */
    public CacheStats stats() {
        return cache.stats();
    }

    /**
     * Gets the estimated number of entries.
     *
     * @return the size
     */
    public long size() {
        cache.cleanUp();
        return cache.estimatedSize();
    }

    /**
     * Creates a new builder.
     *
     * @return the builder
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Builder for CaffeineEvaluationCache.
     */
    public static class Builder {
        private Duration expireAfterWrite = Duration.ofSeconds(10);
        private int maximumSize = 10000;
        private boolean recordStats = false;

        private Builder() {}

        /**
         * Sets the duration after which entries expire.
         *
         * @param duration the expiration duration
         * @return this builder
         */
        public Builder expireAfterWrite(Duration duration) {
            this.expireAfterWrite = duration;
            return this;
        }

        /**
         * Sets the maximum cache size.
         *
         * @param size the maximum size
         * @return this builder
         */
        public Builder maximumSize(int size) {
            this.maximumSize = size;
            return this;
        }

        /**
         * Enables cache statistics recording.
         *
         * @return this builder
         */
        public Builder recordStats() {
            this.recordStats = true;
            return this;
        }

        /**
         * Builds the cache.
         *
         * @return the cache
         */
        public CaffeineEvaluationCache build() {
            Caffeine<Object, Object> builder = Caffeine.newBuilder()
                    .expireAfterWrite(expireAfterWrite)
                    .maximumSize(maximumSize);

            if (recordStats) {
                builder.recordStats();
            }

            return new CaffeineEvaluationCache(builder.build());
        }
    }

    /**
     * Cache key combining a feature key with the complete evaluation context.
     *
     * <p>The key deliberately retains the immutable {@link EvaluationContext} for
     * the configured entry lifetime instead of using only its hash. Hashes can
     * collide (for example, {@code "Aa"} and {@code "BB"}), while targeting can
     * depend on groups, traits, claims, request data, and entity properties as
     * well as identity. This keeps those contexts isolated. It uses more
     * process memory and retains the context's sensitive values until Caffeine
     * evicts the entry, so applications should set an appropriate bounded size
     * and expiry and must not expose cache keys in logs.</p>
     */
    private static final class CacheKey {
        private final String featureKey;
        private final EvaluationContext context;

        CacheKey(String featureKey, EvaluationContext context) {
            this.featureKey = featureKey;
            this.context = context;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            CacheKey cacheKey = (CacheKey) o;
            return Objects.equals(featureKey, cacheKey.featureKey) &&
                    Objects.equals(context, cacheKey.context);
        }

        @Override
        public int hashCode() {
            return Objects.hash(featureKey, context);
        }
    }
}
