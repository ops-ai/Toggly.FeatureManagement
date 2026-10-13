package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import io.toggly.core.telemetry.FeatureStatPayload;
import io.toggly.core.telemetry.FeatureUsageScope;
import io.toggly.core.telemetry.MetricsGrpcClient;
import io.toggly.core.telemetry.MetricStatPayload;
import io.toggly.core.telemetry.TelemetryRuntime;
import io.toggly.core.telemetry.UsageGrpcClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.*;

class TogglyClientTelemetryTest {

    private TogglyClient client;
    private InMemorySnapshotProvider snapshotProvider;
    private final List<FeatureStatPayload> usageSent = new ArrayList<>();
    private final List<MetricStatPayload> metricsSent = new ArrayList<>();

    @BeforeEach
    void setUp() {
        usageSent.clear();
        metricsSent.clear();

        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableUsageTracking(true)
                .enableMetrics(true)
                .usageFlushInterval(Duration.ZERO)
                .metricsFlushInterval(Duration.ZERO)
                .build();

        TelemetryRuntime telemetry = TelemetryRuntime.builder()
                .appKey(config.getAppKey())
                .environment(config.getEnvironment())
                .enableUsageTracking(true)
                .enableMetrics(true)
                .usageFlushInterval(Duration.ZERO)
                .metricsFlushInterval(Duration.ZERO)
                .usageClient(new UsageGrpcClient() {
                    @Override
                    public void sendStats(FeatureStatPayload payload) {
                        usageSent.add(payload);
                    }

                    @Override
                    public void close() {
                        // Test double: no gRPC channel to shut down.
                    }
                })
                .metricsClient(new MetricsGrpcClient() {
                    @Override
                    public void sendMetrics(MetricStatPayload payload) {
                        metricsSent.add(payload);
                    }

                    @Override
                    public void close() {
                        // Test double: no gRPC channel to shut down.
                    }
                })
                .build();

        snapshotProvider = new InMemorySnapshotProvider();
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("always-on", FeatureDefinition.builder()
                .featureKey("always-on")
                .filters(List.of(FeatureFilter.of("AlwaysOn", Map.of())))
                .build());
        snapshotProvider.setFeatures(features);

        client = new TogglyClient(config, snapshotProvider, null, telemetry);
    }

    @AfterEach
    void tearDown() {
        if (client != null) {
            client.close();
        }
    }

    @Test
    void isEnabledRecordsCheckWhenUsageEnabled() {
        assertTrue(client.isEnabled("always-on", EvaluationContext.builder().identity("u1").build()));
        client.flushTelemetry();

        assertThat(usageSent).hasSize(1);
        assertThat(usageSent.get(0).getStats().get(0).getFeature()).isEqualTo("always-on");
        assertThat(usageSent.get(0).getStats().get(0).getVariantStats().get("enabled").getCheckCount())
                .isEqualTo(1);
    }

    @Test
    void recordUsageAndMetricsApisFlush() {
        client.recordUsage("always-on", "u1");
        client.recordView("always-on", "u1");
        client.measure("revenue", 5.0);
        client.incrementCounter("clicks");
        client.observe("gauge", 1.0);
        client.flushTelemetry();

        assertThat(usageSent).hasSize(1);
        assertThat(metricsSent).hasSize(1);
        assertThat(metricsSent.get(0).getStats()).isNotEmpty();
        assertThat(metricsSent.get(0).getCounters()).isNotEmpty();
        assertThat(metricsSent.get(0).getObservations()).isNotEmpty();
    }
    @Test
    void useScopeRecordsDurationAndErrors() {
        client.use("always-on", scope -> "ok");
        client.use("always-on", scope -> {
            scope.fail();
            return null;
        });
        assertThatThrownBy(() -> client.use("always-on", scope -> {
            throw new IllegalStateException("boom");
        })).isInstanceOf(IllegalStateException.class);
        client.flushTelemetry();

        assertThat(usageSent).isNotEmpty();
        var vs = usageSent.get(0).getStats().stream()
                .filter(s -> "always-on".equals(s.getFeature()))
                .findFirst()
                .orElseThrow()
                .getVariantStats()
                .get("enabled");
        assertThat(vs.getUsedCount()).isGreaterThanOrEqualTo(3);
        assertThat(vs.getErrorCount()).isGreaterThanOrEqualTo(2);
        assertThat(vs.getDurationSumMs() + vs.getErrorDurationSumMs()).isGreaterThanOrEqualTo(0);
    }

    @Test
    void beginUsageNoopForBlankFeature() {
        try (var scope = client.beginUsage("")) {
            scope.fail();
        }
        client.flushTelemetry();
        assertThat(usageSent).isEmpty();
    }

    @Test
    void useRunnableAndBeginUsageWithIdentity() {
        final boolean[] ran = {false};
        client.use("always-on", () -> ran[0] = true);
        assertThat(ran[0]).isTrue();
        try (FeatureUsageScope scope = client.beginUsage("always-on", "user-x", "blue")) {
            assertThat(scope).isNotNull();
        }
        client.flushTelemetry();
        assertThat(usageSent).isNotEmpty();
        boolean sawBlue = usageSent.stream()
                .flatMap(p -> p.getStats().stream())
                .anyMatch(s -> s.getVariantStats().containsKey("blue"));
        assertThat(sawBlue).isTrue();
    }

    @Test
    void useAppliesActionWhenTelemetryNullPathUsesNoop() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        try (TogglyClient disabled = new TogglyClient(config, snapshotProvider)) {
            Integer value = disabled.use("always-on", scope -> {
                scope.fail();
                return 42;
            });
            assertThat(value).isEqualTo(42);
        }
    }

    @Test
    void useRejectsNullAction() {
        assertThatThrownBy(() -> client.use("always-on", (java.util.function.Function<FeatureUsageScope, Object>) null))
                .isInstanceOf(IllegalArgumentException.class);
        Integer nullKey = client.use((String) null, scope -> 1);
        Integer emptyKey = client.use("", scope -> 2);
        assertThat(nullKey).isEqualTo(1);
        assertThat(emptyKey).isEqualTo(2);
    }

}
