package io.toggly.cache.caffeine;

import com.github.benmanes.caffeine.cache.CacheLoader;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;

import java.util.concurrent.CompletableFuture;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Caching snapshot provider using Caffeine.
 *
 * <p>Wraps another provider and caches the results for improved performance.</p>
 *
 * <p>Usage:</p>
 * <pre>{@code
 * SnapshotProvider httpProvider = new HttpSnapshotProvider(config);
 * SnapshotProvider cachedProvider = new CaffeineCachingSnapshotProvider(
 *     httpProvider,
 *     CaffeineCacheConfig.builder()
 *         .expireAfterWrite(Duration.ofMinutes(5))
 *         .refreshAfterWrite(Duration.ofMinutes(1))
 *         .recordStats()
 *         .build()
 * );
 *
 * TogglyClient client = new TogglyClient(config, cachedProvider);
 * }</pre>
 */
public class CaffeineCachingSnapshotProvider implements SnapshotProvider {

    private static final Logger LOGGER = Logger.getLogger(CaffeineCachingSnapshotProvider.class.getName());
    private static final String CACHE_KEY = "snapshot";

    private final SnapshotProvider delegate;
    private final LoadingCache<String, FeatureSnapshot> cache;

    /**
     * Creates a caching provider with default configuration.
     *
     * @param delegate the underlying provider
     */
    public CaffeineCachingSnapshotProvider(SnapshotProvider delegate) {
        this(delegate, CaffeineCacheConfig.defaults());
    }

    /**
     * Creates a caching provider with custom configuration.
     *
     * @param delegate the underlying provider
     * @param config the cache configuration
     */
    public CaffeineCachingSnapshotProvider(SnapshotProvider delegate, CaffeineCacheConfig config) {
        this.delegate = delegate;
        this.cache = buildCache(config);
    }

    private LoadingCache<String, FeatureSnapshot> buildCache(CaffeineCacheConfig config) {
        Caffeine<Object, Object> builder = Caffeine.newBuilder();

        if (config.getExpireAfterWrite() != null) {
            builder.expireAfterWrite(config.getExpireAfterWrite());
        }

        if (config.getRefreshAfterWrite() != null) {
            builder.refreshAfterWrite(config.getRefreshAfterWrite());
        }

        if (config.getMaximumSize() > 0) {
            builder.maximumSize(config.getMaximumSize());
        }

        if (config.isRecordStats()) {
            builder.recordStats();
        }

        CacheLoader<String, FeatureSnapshot> loader = key -> {
            LOGGER.fine("Loading snapshot from delegate");
            return delegate.refresh();
        };

        return builder.build(loader);
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        try {
            FeatureSnapshot snapshot = cache.get(CACHE_KEY);
            return snapshot != null ? snapshot : FeatureSnapshot.empty();
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Error getting cached snapshot", e);
            return delegate.getSnapshot();
        }
    }

    @Override
    public CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
        return CompletableFuture.supplyAsync(this::getSnapshot);
    }

    @Override
    public FeatureSnapshot refresh() {
        cache.invalidate(CACHE_KEY);
        return getSnapshot();
    }

    @Override
    public CompletableFuture<FeatureSnapshot> refreshAsync() {
        cache.invalidate(CACHE_KEY);
        return getSnapshotAsync();
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
     * Invalidates the cache.
     */
    public void invalidate() {
        cache.invalidateAll();
        delegate.clear();
    }

    @Override
    public void clear() {
        invalidate();
    }

    @Override
    public void clearJwks() {
        delegate.clearJwks();
    }

    @Override
    public void close() {
        cache.invalidateAll();
        cache.cleanUp();
        delegate.close();
    }
}
