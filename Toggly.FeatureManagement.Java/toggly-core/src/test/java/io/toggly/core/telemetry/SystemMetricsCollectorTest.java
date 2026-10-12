package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

import static org.assertj.core.api.Assertions.assertThat;

class SystemMetricsCollectorTest {

    @Test
    void emitsSamplerValuesAndStopsTicking() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    () -> List.of(
                            new SystemMetricsCollector.Observation("CpuUsage", 12.5),
                            new SystemMetricsCollector.Observation("MemoryWorkingSet", 4096)),
                    null,
                    scheduler);

            collector.start();
            collector.tick();
            assertThat(observed).containsExactly(
                    new SystemMetricsCollector.Observation("CpuUsage", 12.5),
                    new SystemMetricsCollector.Observation("MemoryWorkingSet", 4096));

            collector.stop();
            int before = observed.size();
            collector.tick();
            assertThat(observed).hasSize(before);
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void clearsPendingCapOnFlush() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    () -> List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0)),
                    null,
                    scheduler);
            collector.start();
            for (int i = 0; i < SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING + 5; i++) {
                collector.tick();
            }
            assertThat(observed).hasSize(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING);
            collector.onFlushed();
            collector.tick();
            assertThat(observed).hasSize(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING + 1);
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }
}
