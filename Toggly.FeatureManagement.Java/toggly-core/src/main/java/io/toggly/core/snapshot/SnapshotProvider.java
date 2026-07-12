package io.toggly.core.snapshot;

import io.toggly.core.crypto.JsonWebKeySet;

import java.time.Instant;
import java.util.concurrent.CompletableFuture;

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
}
