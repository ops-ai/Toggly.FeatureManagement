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

    /**
     * Attaches definition-refresh cache hit/miss recording. Caching wrappers should forward
     * to their HTTP delegate so instrumentation stays in one place.
     *
     * @param recorder hit/miss recorder, or null to clear
     */
    default void setDefinitionCacheRecorder(io.toggly.core.telemetry.DefinitionCacheRecorder recorder) {
        // Default no-op
    }

    // ========== Evaluated variants (dual-rail; additive to definitions) ==========
    //
    // Definitions/definitions-signed remain the source of truth for isEnabled.
    // These methods are populated only when TogglyConfig#isEnableVariants() is
    // true; they exist purely to serve getVariant/getVariantValue and never
    // replace the definitions pipeline above. Default no-ops preserve source
    // compatibility for existing implementations (e.g. custom/test providers);
    // only HttpSnapshotProvider currently implements them for real.

    /**
     * Gets the current evaluated-variants snapshot synchronously.
     *
     * @return the current variant snapshot, empty when variants are disabled
     *     or not yet fetched, never null
     */
    default VariantSnapshot getVariantSnapshot() {
        return VariantSnapshot.empty();
    }

    /**
     * Gets the current evaluated-variants snapshot asynchronously.
     *
     * @return a future that completes with the variant snapshot
     */
    default CompletableFuture<VariantSnapshot> getVariantSnapshotAsync() {
        return CompletableFuture.completedFuture(getVariantSnapshot());
    }

    /**
     * Refreshes the evaluated-variants snapshot from the source. No-op when
     * variants are disabled.
     *
     * @return the refreshed variant snapshot
     */
    default VariantSnapshot refreshVariants() {
        return VariantSnapshot.empty();
    }
}
