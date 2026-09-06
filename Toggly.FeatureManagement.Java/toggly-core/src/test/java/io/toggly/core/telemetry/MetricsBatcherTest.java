package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MetricsBatcherTest {

    @Test
    void aggregatesVariantValuesForMeasureCounterObserve() {
        MetricsBatcher batcher = new MetricsBatcher("app", "Production", "host-1");

        batcher.measure("revenue", 10.5, MetricsFeatureOptions.of("FeatureA", "enabled"));
        batcher.measure("revenue", 2.5, MetricsFeatureOptions.of("FeatureA", "enabled"));
        batcher.incrementCounter("clicks", 3, MetricsFeatureOptions.of("FeatureA", "variant_a"));
        batcher.observe("temperature", 72.0, MetricsFeatureOptions.of(null, "enabled"));

        MetricStatPayload payload = batcher.buildAndReset();
        assertThat(payload).isNotNull();
        assertThat(payload.getAppKey()).isEqualTo("app");
        assertThat(payload.getInstanceName()).isEqualTo("host-1");

        assertThat(payload.getStats()).hasSize(1);
        assertThat(payload.getStats().get(0).getMetric()).isEqualTo("revenue");
        assertThat(payload.getStats().get(0).getFeature()).isEqualTo("FeatureA");
        assertThat(payload.getStats().get(0).getVariantValues().get("enabled")).isEqualTo(13.0);

        assertThat(payload.getCounters()).hasSize(1);
        assertThat(payload.getCounters().get(0).getVariantValues().get("variant_a")).isEqualTo(3.0);

        assertThat(payload.getObservations()).hasSize(1);
        assertThat(payload.getObservations().get(0).getMetric()).isEqualTo("temperature");
        assertThat(payload.getObservations().get(0).getVariantValues().get("enabled")).isEqualTo(72.0);

        assertThat(batcher.buildAndReset()).isNull();
    }
}
