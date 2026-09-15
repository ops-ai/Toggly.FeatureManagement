package io.toggly.cache.redis.jedis8;

import io.toggly.cache.redis.RedisCacheConfig;
import io.toggly.core.snapshot.SnapshotProvider;
import redis.clients.jedis.JedisPool;

import java.time.Duration;

/**
 * Redis snapshot cache adapter for Jedis 8 hosts.
 *
 * <p>This artifact resolves Jedis {@code 8.0.1} and reuses the retained adapter's
 * storage key and snapshot serialization format. Use this class when an application
 * has selected Jedis 8. Use {@code toggly-cache-redis} and
 * {@code io.toggly.cache.redis.RedisCachingSnapshotProvider} for the retained Jedis
 * 5.1 line. Do not add both Toggly Redis adapter artifacts to the same application.</p>
 */
public final class RedisCachingSnapshotProvider
        extends io.toggly.cache.redis.RedisCachingSnapshotProvider {

    /**
     * Creates a Jedis 8 cache provider with default Redis configuration.
     *
     * @param delegate the underlying snapshot provider
     */
    public RedisCachingSnapshotProvider(SnapshotProvider delegate) {
        super(delegate);
    }

    /**
     * Creates a Jedis 8 cache provider with custom Redis configuration.
     *
     * @param delegate the underlying snapshot provider
     * @param config Redis connection and cache configuration
     */
    public RedisCachingSnapshotProvider(SnapshotProvider delegate, RedisCacheConfig config) {
        super(delegate, config);
    }

    /**
     * Creates a Jedis 8 cache provider using an existing pool.
     *
     * @param delegate the underlying snapshot provider
     * @param pool the application-owned Jedis 8 pool
     * @param keyPrefix the cache key prefix
     * @param ttl the TTL for cached entries
     */
    public RedisCachingSnapshotProvider(
            SnapshotProvider delegate,
            JedisPool pool,
            String keyPrefix,
            Duration ttl) {
        super(delegate, pool, keyPrefix, ttl);
    }
}
