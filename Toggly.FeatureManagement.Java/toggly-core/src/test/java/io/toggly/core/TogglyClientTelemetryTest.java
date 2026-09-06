package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import io.toggly.core.telemetry.FeatureStatPayload;
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
                    }
                })
                .metricsClient(new MetricsGrpcClient() {
                    @Override
                    public void sendMetrics(MetricStatPayload payload) {
                        metricsSent.add(payload);
                    }

                    @Override
                    public void close() {
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
}
