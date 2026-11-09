package io.toggly.core.snapshot;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.MetricDefinition;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/**
 * Simple in-memory snapshot provider for testing or static configurations.
 */
public final class InMemorySnapshotProvider implements SnapshotProvider {

    private final AtomicReference<FeatureSnapshot> snapshot;
    private final RefreshListenerSupport refreshListeners =
            new RefreshListenerSupport(InMemorySnapshotProvider.class);

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
        FeatureSnapshot updated = new FeatureSnapshot(
                features,
                current.getMetrics(),
                Instant.now(),
                null,
                current.getSignature(),
                current.getKeyId(),
                current.getSignedTimestamp(),
                current.getSignedDefsJson());
        snapshot.set(updated);
        refreshListeners.notifyListeners(updated);
    }

    /**
     * Updates the entire snapshot.
     *
     * @param newSnapshot the new snapshot
     */
    public void setSnapshot(FeatureSnapshot newSnapshot) {
        FeatureSnapshot updated = newSnapshot != null ? newSnapshot : FeatureSnapshot.empty();
        snapshot.set(updated);
        refreshListeners.notifyListeners(updated);
    }

    @Override
    public void addRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.add(listener);
    }

    @Override
    public void removeRefreshListener(Consumer<FeatureSnapshot> listener) {
        refreshListeners.remove(listener);
    }
}
