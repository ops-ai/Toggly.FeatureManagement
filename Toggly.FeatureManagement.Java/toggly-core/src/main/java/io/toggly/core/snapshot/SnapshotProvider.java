package io.toggly.core.snapshot;

import io.toggly.core.crypto.JsonWebKeySet;

import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * Interface for providing feature snapshots.
 *
 * <p>Implementations can fetch from HTTP, cache, or other sources.</p>
 */
public interface SnapshotProvider {

    /**
     * Gets the current snapshot synchronously.
     *
     * @return the current snapshot, never null
     */
    FeatureSnapshot getSnapshot();

    /**
     * Gets the current snapshot asynchronously.
     *
     * @return a future that completes with the snapshot
     */
    default CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
        return CompletableFuture.completedFuture(getSnapshot());
    }

    /**
     * Refreshes the snapshot from the source.
     *
     * @return the refreshed snapshot
     */
    FeatureSnapshot refresh();

    /**
     * Refreshes the snapshot asynchronously.
     *
     * @return a future that completes with the refreshed snapshot
     */
    default CompletableFuture<FeatureSnapshot> refreshAsync() {
        return CompletableFuture.supplyAsync(this::refresh);
    }

    /**
     * Clears cached feature definitions (and typically JWKS as well).
     */
    default void clear() {
        clearJwks();
    }

    /**
     * Clears cached JWKS so the next signed refresh refetches keys.
     */
    default void clearJwks() {
        // Default no-op
    }

    /**
     * Loads a cached JWKS if this provider persists keys.
     *
     * @return JWKS or null
     */
    default JsonWebKeySet loadJwks() {
        return null;
    }

    /**
     * Persists a JWKS snapshot.
     *
     * @param jwks the key set
     * @param expiry when the cached JWKS should be considered stale
     */
    default void saveJwks(JsonWebKeySet jwks, Instant expiry) {
        // Default no-op
    }

    /**
     * Closes any resources held by this provider.
     */
    default void close() {
        // Default no-op
    }

    /**
     * Attaches definition-refresh cache hit/miss recording. Caching wrappers should forward
     * to their HTTP delegate so instrumentation stays in one place.
     *
     * @param recorder hit/miss recorder, or null to clear
     */
    default void setDefinitionCacheRecorder(io.toggly.core.telemetry.DefinitionCacheRecorder recorder) {
        // Default no-op
    }

    /**
     * Registers a listener invoked when the provider applies a new feature snapshot.
     *
     * <p>Default is a no-op so third-party providers remain source-compatible. Caching
     * wrappers should observe delegate updates, refresh their own cache, then notify
     * their listeners so callbacks read the wrapper's snapshot.</p>
     *
     * <p>Listeners run on the thread that applied the snapshot (for example the caller of
     * {@link #refresh()}, a scheduled poll thread, or a WebSocket callback thread). Listener
     * exceptions should be caught by the provider so they cannot break the refresh path.</p>
     *
     * @param listener callback receiving the newly applied snapshot; null is ignored
     */
    default void addRefreshListener(Consumer<FeatureSnapshot> listener) {
        // Default no-op
    }

    /**
     * Removes a previously registered refresh listener.
     *
     * @param listener the listener to remove; null is ignored
     */
    default void removeRefreshListener(Consumer<FeatureSnapshot> listener) {
        // Default no-op
    }
}
