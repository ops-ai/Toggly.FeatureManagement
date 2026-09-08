package io.toggly.core.telemetry;

/**
 * Records definition-refresh cache hit/miss outcomes for usage telemetry.
 */
public interface DefinitionCacheRecorder {

    /** Served from local/cache without applying a new revision. */
    void recordDefinitionCacheHit();

    /** Applied a new revision from the network. */
    void recordDefinitionCacheMiss();
}
