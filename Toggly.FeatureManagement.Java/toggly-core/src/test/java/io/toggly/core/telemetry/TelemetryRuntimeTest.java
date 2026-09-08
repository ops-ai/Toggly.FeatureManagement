package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryRuntimeTest {

    @Test
    void flushesUsageAndMetricsViaInjectedClients() {
        List<FeatureStatPayload> usageSent = new ArrayList<>();
        List<MetricStatPayload> metricsSent = new ArrayList<>();

        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) {
                usageSent.add(payload);
            }

            @Override
            public void close() {
            }
        };
        MetricsGrpcClient metricsClient = new MetricsGrpcClient() {
            @Override
            public void sendMetrics(MetricStatPayload payload) {
                metricsSent.add(payload);
            }

            @Override
            public void close() {
            }
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .environment("Test")
                .enableUsageTracking(true)
                .enableMetrics(true)
                .usageFlushInterval(Duration.ZERO)
                .metricsFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .metricsClient(metricsClient)
                .build();
        runtime.start();

        runtime.recordCheck("FeatureA", true, "user-1");
        runtime.recordUsage("FeatureA", "user-1");
        runtime.measure("m1", 1.0, null);
        runtime.flushAll();

        assertThat(usageSent).hasSize(1);
        assertThat(usageSent.get(0).getStats()).hasSize(1);
        assertThat(metricsSent).hasSize(1);
        assertThat(metricsSent.get(0).getStats()).hasSize(1);

        runtime.close();
        assertThat(runtime.isUsageEnabled()).isFalse();
    }

    @Test
    void skipsUsageWhenDisabled() {
        AtomicInteger usageCalls = new AtomicInteger();
        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) {
                usageCalls.incrementAndGet();
            }

            @Override
            public void close() {
            }
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .enableUsageTracking(false)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .metricsFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .build();
        runtime.start();
        runtime.recordCheck("FeatureA", true, "user-1");
        runtime.flushAll();
        assertThat(usageCalls.get()).isZero();
        runtime.close();
    }

    @Test
    void singleFlightSkipsOverlappingUsageFlush() throws Exception {
        AtomicInteger sendCount = new AtomicInteger();
        Object gate = new Object();
        AtomicInteger entered = new AtomicInteger();

        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) throws Exception {
                sendCount.incrementAndGet();
                entered.incrementAndGet();
                synchronized (gate) {
                    gate.wait(2000);
                }
            }

            @Override
            public void close() {
            }
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .enableUsageTracking(true)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .build();
        runtime.start();
        runtime.recordCheck("FeatureA", true, "u");

        Thread t1 = new Thread(runtime::flushUsage);
        t1.start();
        while (entered.get() == 0) {
            Thread.sleep(10);
        }
        runtime.flushUsage(); // should no-op while first in flight
        synchronized (gate) {
            gate.notifyAll();
        }
        t1.join(3000);

        assertThat(sendCount.get()).isEqualTo(1);
        runtime.close();
    }

    @Test
    void restoresFullUsageBatchWhenSendStatsFailsThenSucceeds() {
        AtomicInteger calls = new AtomicInteger();
        List<FeatureStatPayload> sent = new ArrayList<>();
        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) throws Exception {
                int n = calls.incrementAndGet();
                if (n == 1) {
                    throw new RuntimeException("transient send failure");
                }
                sent.add(payload);
            }

            @Override
            public void close() {
            }
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .enableUsageTracking(true)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .build();
        runtime.start();

        runtime.recordCheck("FeatureA", true, "user-1");
        runtime.recordDefinitionCacheHit();
        runtime.recordDefinitionCacheMiss();

        runtime.flushUsage();
        assertThat(calls.get()).isEqualTo(1);
        assertThat(sent).isEmpty();

        runtime.flushUsage();
        assertThat(calls.get()).isEqualTo(2);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isEqualTo(1);
        assertThat(sent.get(0).getStats().get(0).getFeature()).isEqualTo("FeatureA");

        runtime.close();
    }

    @Test
    void closeSafeRestoreUsesCapturedBatcherAcrossFailedSend() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicReference<Exception> sendError = new AtomicReference<>();

        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) throws Exception {
                entered.countDown();
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("release timed out");
                }
                Exception failure = sendError.get();
                if (failure != null) {
                    throw failure;
                }
            }

            @Override
            public void close() {
            }
        };

        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("app")
                .enableUsageTracking(true)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .build();
        runtime.start();
        runtime.recordCheck("FeatureA", true, "user-1");
        runtime.recordDefinitionCacheHit();

        Field batcherField = TelemetryRuntime.class.getDeclaredField("usageBatcher");
        batcherField.setAccessible(true);
        UsageBatcher held = (UsageBatcher) batcherField.get(runtime);

        Thread flush = new Thread(runtime::flushUsage);
        flush.start();
        assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();

        // Simulate close() clearing the field while sendStats is still in flight.
        batcherField.set(runtime, null);
        sendError.set(new RuntimeException("send failed after close"));
        release.countDown();
        flush.join(5000);

        FeatureStatPayload restored = held.buildAndReset();
        assertThat(restored).isNotNull();
        assertThat(restored.getDefinitionCacheHits()).isEqualTo(1);
        assertThat(restored.getStats().get(0).getVariantStats().get("enabled").getCheckCount())
                .isEqualTo(1);

        runtime.close();
    }
}
