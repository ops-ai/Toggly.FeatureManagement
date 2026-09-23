package io.toggly.core.snapshot;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.MetricDefinition;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Simple in-memory snapshot provider for testing or static configurations.
 */
public final class InMemorySnapshotProvider implements SnapshotProvider {

    private final AtomicReference<FeatureSnapshot> snapshot;

    /**
     * Creates an empty provider.
     */
    public InMemorySnapshotProvider() {
        this.snapshot = new AtomicReference<>(FeatureSnapshot.empty());
    }

    /**
     * Creates a provider with initial features.
     *
     * @param features the initial feature definitions
     */
    public InMemorySnapshotProvider(Map<String, FeatureDefinition> features) {
        this.snapshot = new AtomicReference<>(
                new FeatureSnapshot(features, null, Instant.now(), null));
    }

    /**
     * Creates a provider with initial features and metrics.
     *
     * @param features the initial feature definitions
     * @param metrics the initial metric definitions
     */
    public InMemorySnapshotProvider(
            Map<String, FeatureDefinition> features,
            Map<String, MetricDefinition> metrics) {
        this.snapshot = new AtomicReference<>(
                new FeatureSnapshot(features, metrics, Instant.now(), null));
    }

    @Override
    public FeatureSnapshot getSnapshot() {
        return snapshot.get();
    }

    @Override
    public FeatureSnapshot refresh() {
        // In-memory provider doesn't refresh from external source
        return snapshot.get();
    }

    @Override
    public void clear() {
        snapshot.set(FeatureSnapshot.empty());
        clearJwks();
    }

    /**
     * Updates the snapshot with new features.
     *
     * @param features the new feature definitions
     */
    public void setFeatures(Map<String, FeatureDefinition> features) {
        FeatureSnapshot current = snapshot.get();
        snapshot.set(new FeatureSnapshot(
                features,
                current.getMetrics(),
                Instant.now(),
                null,
                current.getSignature(),
                current.getKeyId(),
                current.getSignedTimestamp(),
                current.getSignedDefsJson()));
    }

    /**
     * Updates the entire snapshot.
     *
     * @param newSnapshot the new snapshot
     */
    public void setSnapshot(FeatureSnapshot newSnapshot) {
        snapshot.set(newSnapshot != null ? newSnapshot : FeatureSnapshot.empty());
    }
}
