package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

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
}
