package io.toggly.core.snapshot;

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
     * Closes any resources held by this provider.
     */
    default void close() {
        // Default no-op
    }
}
