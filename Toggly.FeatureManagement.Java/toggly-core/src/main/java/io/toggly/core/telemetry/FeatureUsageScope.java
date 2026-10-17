package io.toggly.core.telemetry;

import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Tracks one or more feature usage attempts with duration and optional failure.
 * Close to record the outcome. Does not evaluate feature flags.
 */
public final class FeatureUsageScope implements AutoCloseable {

    private final TelemetryRuntime telemetry;
    private final List<String> featureKeys;
    private final String variant;
    private final long startNanos;
    private boolean failed;
    private boolean cancelled;
    private boolean completed;

    /** No-op scope when telemetry is disabled. */
    public static FeatureUsageScope noop() {
        return new FeatureUsageScope(null, List.of(), "enabled");
    }

    public FeatureUsageScope(
            TelemetryRuntime telemetry, List<String> featureKeys, String variant) {
        this.telemetry = telemetry;
        this.featureKeys = featureKeys == null ? List.of() : List.copyOf(featureKeys);
        this.variant = variant == null || variant.isEmpty() ? "enabled" : variant;
        this.startNanos = System.nanoTime();
    }

    /** Marks the scope as failed without throwing. */
    public void fail() {
        failed = true;
    }

    /** Marks cancellation: attempt stays recorded; no error or duration. */
    public void markCancelled() {
        cancelled = true;
    }

    @Override
    public void close() {
        complete();
    }

    private void complete() {
        if (completed) {
            return;
        }
        completed = true;
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
        if (durationMs < 0) {
            durationMs = 0;
        }
        if (cancelled || telemetry == null) {
            return;
        }
        for (String featureKey : featureKeys) {
            if (failed) {
                telemetry.recordUsageScopeFailure(featureKey, durationMs, variant);
            } else {
                telemetry.recordUsageScopeSuccess(featureKey, durationMs, variant);
            }
        }
    }
}
