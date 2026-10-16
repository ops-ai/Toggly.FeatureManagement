package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryRuntimeSystemMetricsTest {

    @Test
    void doesNotSampleWhenSystemMetricsDisabled() throws Exception {
        CountDownLatch sampled = new CountDownLatch(1);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(false)
                .enableMetrics(true)
                .metricsFlushInterval(Duration.ZERO)
                .systemMetrics(false)
                .systemMetricsIntervalMs(30)
                .systemMetricsSampler(() -> {
                    sampled.countDown();
                    return List.of(new SystemMetricsCollector.Observation("CpuUsage", 1));
                })
                .metricsClient(new MetricsGrpcClient() {
                    @Override
                    public void sendMetrics(MetricStatPayload payload) {}

                    @Override
                    public void close() {}
                })
                .build();
        runtime.start();
        assertThat(sampled.await(200, TimeUnit.MILLISECONDS)).isFalse();
        runtime.close();
    }

    @Test
    void samplesAndFlushesWhenEnabled() throws Exception {
        CountDownLatch sampled = new CountDownLatch(1);
        List<MetricStatPayload> sent = new ArrayList<>();
        MetricsGrpcClient client = new MetricsGrpcClient() {
            @Override
            public void sendMetrics(MetricStatPayload payload) {
                synchronized (sent) {
                    sent.add(payload);
                }
            }

            @Override
            public void close() {}
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(false)
                .enableMetrics(true)
                .metricsFlushInterval(Duration.ZERO)
                .systemMetrics(true)
                .systemMetricsIntervalMs(30)
                .systemMetricsSampler(() -> {
                    sampled.countDown();
                    return List.of(new SystemMetricsCollector.Observation("CpuUsage", 9));
                })
                .metricsClient(client)
                .build();
        runtime.start();
        assertThat(sampled.await(2, TimeUnit.SECONDS)).isTrue();
        TimeUnit.MILLISECONDS.sleep(50);
        runtime.flushMetrics();
        synchronized (sent) {
            assertThat(sent).hasSize(1);
            assertThat(sent.get(0).getObservations().stream().anyMatch(o -> "CpuUsage".equals(o.getMetric())))
                    .isTrue();
        }
        runtime.close();
    }

    @Test
    void doesNotStartWhenMetricsDisabled() throws Exception {
        CountDownLatch sampled = new CountDownLatch(1);
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(false)
                .enableMetrics(false)
                .systemMetrics(true)
                .systemMetricsIntervalMs(30)
                .systemMetricsSampler(() -> {
                    sampled.countDown();
                    return List.of();
                })
                .build();
        runtime.start();
        assertThat(sampled.await(200, TimeUnit.MILLISECONDS)).isFalse();
        runtime.close();
    }

    @Test
    void clearsSystemMetricsPendingAfterFailedMetricsFlush() throws Exception {
        AtomicInteger sampleCount = new AtomicInteger();
        AtomicInteger sendAttempts = new AtomicInteger();
        MetricsGrpcClient client = new MetricsGrpcClient() {
            @Override
            public void sendMetrics(MetricStatPayload payload) {
                sendAttempts.incrementAndGet();
                throw new RuntimeException("send failed");
            }

            @Override
            public void close() {}
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Production")
                .enableUsageTracking(false)
                .enableMetrics(true)
                .metricsFlushInterval(Duration.ofSeconds(60))
                .systemMetrics(true)
                .systemMetricsIntervalMs(20)
                .systemMetricsSampler(() -> {
                    sampleCount.incrementAndGet();
                    return List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0));
                })
                .metricsClient(client)
                .build();
        runtime.start();

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (sampleCount.get() < SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING + 2
                && System.nanoTime() < deadline) {
            TimeUnit.MILLISECONDS.sleep(25);
        }
        assertThat(sampleCount.get())
                .isGreaterThanOrEqualTo(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING + 2);

        int samplesBeforeFlush = sampleCount.get();
        runtime.flushMetrics();
        assertThat(sendAttempts.get()).isEqualTo(1);

        deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (sampleCount.get() <= samplesBeforeFlush && System.nanoTime() < deadline) {
            TimeUnit.MILLISECONDS.sleep(25);
        }
        assertThat(sampleCount.get()).isGreaterThan(samplesBeforeFlush);
        runtime.close();
    }
}
