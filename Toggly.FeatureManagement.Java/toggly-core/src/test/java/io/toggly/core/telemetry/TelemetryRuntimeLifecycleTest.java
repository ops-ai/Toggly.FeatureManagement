package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryRuntimeLifecycleTest {

    @Test
    void scheduledFlushSendsMetricsAndCloseIsIdempotent() throws Exception {
        List<MetricStatPayload> sent = new ArrayList<>();
        CountDownLatch delivered = new CountDownLatch(1);
        AtomicInteger closes = new AtomicInteger();
        MetricsGrpcClient client = new MetricsGrpcClient() {
            @Override
            public void sendMetrics(MetricStatPayload payload) {
                synchronized (sent) {
                    sent.add(payload);
                }
                delivered.countDown();
            }

            @Override
            public void close() {
                closes.incrementAndGet();
            }
        };
        TelemetryRuntime runtime = TelemetryRuntime.builder().appKey("app")
                .environment(null)
                .enableUsageTracking(false).enableMetrics(true)
                .metricsFlushInterval(Duration.ofMillis(20))
                .metricsClient(client).build();

        runtime.start();
        assertThat(runtime.isMetricsEnabled()).isTrue();
        assertThat(runtime.isUsageEnabled()).isFalse();
        runtime.measure("duration", 3, null);
        runtime.incrementCounter("orders", 2, null);
        runtime.observe("temperature", 7, null);

        assertThat(delivered.await(2, TimeUnit.SECONDS)).isTrue();
        synchronized (sent) {
            assertThat(sent).isNotEmpty();
            assertThat(sent.get(0).getStats()).isNotEmpty();
        }
        runtime.close();
        runtime.close();
        assertThat(closes).hasValue(1);
        assertThat(runtime.isMetricsEnabled()).isFalse();
        runtime.start();
        assertThat(runtime.isMetricsEnabled()).isFalse();
    }

    @Test
    void emptyBatchAndDisabledRuntimeDoNotSendOrSchedule() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        AtomicInteger closes = new AtomicInteger();
        UsageGrpcClient client = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) {
                sent.add(payload);
            }

            @Override
            public void close() {
                closes.incrementAndGet();
            }
        };
        TelemetryRuntime runtime = TelemetryRuntime.builder().appKey("app")
                .enableMetrics(false).enableUsageTracking(true)
                .usageFlushInterval(Duration.ZERO).usageClient(client).build();
        runtime.start();
        runtime.flushUsage();
        assertThat(sent).isEmpty();
        runtime.recordView("flag", "user", "treatment");
        runtime.recordUsage("flag", "user", "treatment");
        runtime.recordCheck("flag", true, "user", "treatment", true);
        runtime.flushAll();
        assertThat(sent).hasSize(1);
        runtime.close();
        assertThat(closes).hasValue(1);
    }
}
