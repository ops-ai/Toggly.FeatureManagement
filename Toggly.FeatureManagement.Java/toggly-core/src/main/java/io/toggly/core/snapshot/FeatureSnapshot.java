package io.toggly.core.snapshot;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.MetricDefinition;

import java.time.Instant;
import java.util.Collections;
import java.util.Map;

/**
 * Immutable snapshot of feature definitions at a point in time.
 */
public final class FeatureSnapshot {

    private final Map<String, FeatureDefinition> features;
    private final Map<String, MetricDefinition> metrics;
    private final Instant timestamp;
    private final String etag;

    public FeatureSnapshot(
            Map<String, FeatureDefinition> features,
            Map<String, MetricDefinition> metrics,
            Instant timestamp,
            String etag) {
        this.features = features != null
                ? Collections.unmodifiableMap(features)
                : Collections.emptyMap();
        this.metrics = metrics != null
                ? Collections.unmodifiableMap(metrics)
                : Collections.emptyMap();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.etag = etag;
    }

    /**
     * Gets all feature definitions.
     *
     * @return unmodifiable map of feature key to definition
     */
    public Map<String, FeatureDefinition> getFeatures() {
        return features;
    }

    /**
     * Gets a specific feature definition.
     *
     * @param featureKey the feature key
     * @return the definition or null if not found
     */
    public FeatureDefinition getFeature(String featureKey) {
        return features.get(featureKey);
    }

    /**
     * Gets all metric definitions.
     *
     * @return unmodifiable map of metric key to definition
     */
    public Map<String, MetricDefinition> getMetrics() {
        return metrics;
    }

    /**
     * Gets the timestamp when this snapshot was created.
     *
     * @return the timestamp
     */
    public Instant getTimestamp() {
        return timestamp;
    }

    /**
     * Gets the ETag for cache validation.
     *
     * @return the etag or null
     */
    public String getEtag() {
        return etag;
    }

    /**
     * Checks if this snapshot is empty.
     *
     * @return true if no features are defined
     */
    public boolean isEmpty() {
        return features.isEmpty();
    }

    /**
     * Creates an empty snapshot.
     *
     * @return an empty snapshot
     */
    public static FeatureSnapshot empty() {
        return new FeatureSnapshot(null, null, Instant.now(), null);
    }
}
