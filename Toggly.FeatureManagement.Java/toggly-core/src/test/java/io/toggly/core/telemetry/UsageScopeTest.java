package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UsageScopeTest {

    @Test
    void useScopeSuccessRecordsDuration() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", null, null);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(true)
                .build();
        injectBatcher(runtime, batcher);

        try (FeatureUsageScope scope = runtime.beginUsage(null, "enabled", "ScopeFeat")) {
            assertThat(scope).isNotNull();
        }

        FeatureStatPayload payload = batcher.buildAndReset();
        var vs = payload.getStats().get(0).getVariantStats().get("enabled");
        assertThat(vs.getUsedCount()).isEqualTo(1);
        assertThat(vs.getErrorCount()).isZero();
        assertThat(vs.getDurationSumMs()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void useScopeFailureRecordsError() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", null, null);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(true)
                .build();
        injectBatcher(runtime, batcher);

        FeatureUsageScope scope = runtime.beginUsage(null, "enabled", "FailFeat");
        scope.fail();
        scope.close();

        var vs = batcher.buildAndReset().getStats().get(0).getVariantStats().get("enabled");
        assertThat(vs.getUsedCount()).isEqualTo(1);
        assertThat(vs.getErrorCount()).isEqualTo(1);
    }

    @Test
    void cancelledScopeRecordsAttemptOnly() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", null, null);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(true)
                .build();
        injectBatcher(runtime, batcher);

        FeatureUsageScope scope = runtime.beginUsage(null, "enabled", "CancelFeat");
        scope.markCancelled();
        scope.close();

        var vs = batcher.buildAndReset().getStats().get(0).getVariantStats().get("enabled");
        assertThat(vs.getUsedCount()).isEqualTo(1);
        assertThat(vs.getErrorCount()).isZero();
        assertThat(vs.getDurationSumMs()).isZero();
    }

    @Test
    void noopScopeDoesNotRecord() {
        try (FeatureUsageScope scope = FeatureUsageScope.noop()) {
            scope.fail();
        }
    }

    @Test
    void doubleCloseIsIdempotent() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", null, null);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(true)
                .build();
        injectBatcher(runtime, batcher);

        FeatureUsageScope scope = runtime.beginUsage(null, "enabled", "Twice");
        scope.close();
        scope.close();
        var vs = batcher.buildAndReset().getStats().get(0).getVariantStats().get("enabled");
        assertThat(vs.getUsedCount()).isEqualTo(1);
    }

    private static void injectBatcher(TelemetryRuntime runtime, UsageBatcher batcher) {
        try {
            var field = TelemetryRuntime.class.getDeclaredField("usageBatcher");
            field.setAccessible(true);
            field.set(runtime, batcher);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }
}
