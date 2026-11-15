package io.toggly.cache.caffeine;

import com.github.benmanes.caffeine.cache.CacheLoader;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.RefreshListenerSupport;
import io.toggly.core.snapshot.SnapshotProvider;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
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
    private final RefreshListenerSupport refreshListeners =
            new RefreshListenerSupport(CaffeineCachingSnapshotProvider.class);
    /**
     * True only on the synchronous {@link CacheLoader#load} path. {@code put}/{@code get}
     * of the key being loaded throws {@link IllegalStateException} ("Recursive update").
     * Async {@link CacheLoader#reload} does not set this, so background refreshes can
     * publish into the cache before listeners run.
     */
    private final ThreadLocal<Boolean> synchronousLoad = new ThreadLocal<>();
    /** Snapshot applied during a synchronous load; published after the load installs it. */
    private final ThreadLocal<FeatureSnapshot> pendingLoadNotification = new ThreadLocal<>();
    private final ThreadLocal<Boolean> notifyingListeners = new ThreadLocal<>();
    private final Consumer<FeatureSnapshot> delegateRefreshBridge = this::onDelegateSnapshotApplied;

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
        this.delegate.addRefreshListener(delegateRefreshBridge);
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

        CacheLoader<String, FeatureSnapshot> loader = new CacheLoader<>() {
            @Override
            public FeatureSnapshot load(String key) {
                LOGGER.fine("Loading snapshot from delegate");
                synchronousLoad.set(Boolean.TRUE);
                try {
                    return delegate.refresh();
                } finally {
                    synchronousLoad.remove();
                }
            }

            @Override
            public FeatureSnapshot reload(String key, FeatureSnapshot oldValue) {
                // Refresh-after-write runs off the compute lock, so the bridge can
                // cache.put before notifying. Do not use load() here: that defers
                // notification onto this executor thread, where nobody flushes it.
                LOGGER.fine("Refreshing snapshot from delegate");
                return delegate.refresh();
            }
        };

        return builder.build(loader);
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        try {
            FeatureSnapshot snapshot = Objects.requireNonNullElseGet(
                    cache.get(CACHE_KEY), FeatureSnapshot::empty);
            publishPendingLoadNotification();
            return snapshot;
        } catch (Exception e) {
            pendingLoadNotification.remove();
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
    public void setDefinitionCacheRecorder(io.toggly.core.telemetry.DefinitionCacheRecorder recorder) {
        delegate.setDefinitionCacheRecorder(recorder);
    }

    @Override
    public void addRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.add(listener);
    }

    @Override
    public void removeRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.remove(listener);
    }

    /**
     * Installs a delegate-applied snapshot into the cache, then notifies listeners.
     * Synchronous loads cannot {@code put} the key they are computing, so that path
     * records the snapshot and {@link #getSnapshot()} publishes it after the load.
     */
    private void onDelegateSnapshotApplied(FeatureSnapshot snapshot) {
        if (snapshot == null) {
            return;
        }
        if (Boolean.TRUE.equals(synchronousLoad.get())) {
            pendingLoadNotification.set(snapshot);
            return;
        }
        cache.put(CACHE_KEY, snapshot);
        notifyListeners(snapshot);
    }

    private void publishPendingLoadNotification() {
        FeatureSnapshot snapshot = pendingLoadNotification.get();
        if (snapshot == null) {
            return;
        }
        pendingLoadNotification.remove();
        notifyListeners(snapshot);
    }

    private void notifyListeners(FeatureSnapshot snapshot) {
        if (Boolean.TRUE.equals(notifyingListeners.get())) {
            return;
        }
        notifyingListeners.set(Boolean.TRUE);
        try {
            refreshListeners.notifyListeners(snapshot);
        } finally {
            notifyingListeners.remove();
        }
    }

    @Override
    public void close() {
        delegate.removeRefreshListener(delegateRefreshBridge);
        cache.invalidateAll();
        cache.cleanUp();
        delegate.close();
    }
}
