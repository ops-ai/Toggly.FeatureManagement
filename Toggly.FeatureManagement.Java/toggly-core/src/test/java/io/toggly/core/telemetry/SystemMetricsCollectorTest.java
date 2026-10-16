package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class SystemMetricsCollectorTest {

    @Test
    void tickBeforeStartDoesNothing() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    () -> List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0)),
                    null,
                    scheduler);
            collector.tick();
            assertThat(observed).isEmpty();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void tickSwallowsObserveFailures() {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> {
                        throw new IllegalStateException("observe failed");
                    },
                    10_000L,
                    () -> List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0)),
                    null,
                    scheduler);
            collector.start();
            collector.tick();
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

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

    @Test
    void readLinuxVmRssBytesReturnsNullOnNonLinux() {
        if ("Linux".equalsIgnoreCase(System.getProperty("os.name"))) {
            return;
        }
        assertThat(SystemMetricsCollector.readLinuxVmRssBytes()).isNull();
    }

    @EnabledOnOs(OS.LINUX)
    @Test
    void readLinuxVmRssBytesReadsProcSelfStatusOnLinux() {
        Long rss = SystemMetricsCollector.readLinuxVmRssBytes();
        assertThat(rss).isNotNull().isPositive();
    }

    @EnabledOnOs(OS.LINUX)
    @Test
    void defaultSamplerEmitsMemoryWorkingSetOnLinux() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            collector.tick();
            assertThat(observed.stream().map(SystemMetricsCollector.Observation::metric))
                    .contains("MemoryWorkingSet");
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void scheduledExecutorInvokesSamplingWithoutManualTick() throws Exception {
        CountDownLatch sampled = new CountDownLatch(1);
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> sampled.countDown(),
                    50L,
                    () -> List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0)),
                    null,
                    scheduler);
            collector.start();
            assertThat(sampled.await(2, TimeUnit.SECONDS)).isTrue();
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void defaultSamplerEmitsHeapAndCpuAfterWarmup() throws Exception {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        AtomicLong nanoTime = new AtomicLong(1_000_000_000L);
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    () -> nanoTime.addAndGet(500_000_000L),
                    scheduler);
            collector.start();
            collector.tick();
            collector.tick();
            assertThat(observed.stream().map(SystemMetricsCollector.Observation::metric))
                    .contains("GCHeapSize");
            assertThat(observed.stream().filter(o -> "CpuUsage".equals(o.metric())))
                    .anyMatch(o -> o.value() >= 0 && o.value() <= 100);
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void defaultSamplerEmitsAllocationRateAfterAllocation() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            collector.tick();
            byte[] scratch = new byte[512 * 1024];
            scratch[0] = 1;
            try {
                Thread.sleep(15);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            collector.tick();
            assertThat(observed.stream().map(SystemMetricsCollector.Observation::metric))
                    .contains("AllocationRate");
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void defaultSamplerEmitsTimeInGcOnSecondTick() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            collector.tick();
            System.gc();
            collector.tick();
            assertThat(observed.stream().filter(o -> "TimeInGC".equals(o.metric())))
                    .anyMatch(o -> o.value() >= 0 && o.value() <= 100);
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void defaultSamplerEmitsExceptionCountFromUncaughtHandler() throws Exception {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            Thread t = new Thread(() -> {
                throw new RuntimeException("metrics-test");
            });
            t.start();
            t.join();
            collector.tick();
            assertThat(observed).contains(new SystemMetricsCollector.Observation("ExceptionCount", 1.0));
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void exceptionCountPendingGateBlocksUntilFlush() throws Exception {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            for (int i = 0; i < SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING; i++) {
                final int index = i;
                Thread t = new Thread(() -> {
                    throw new RuntimeException("ex-" + index);
                });
                t.start();
                t.join();
                collector.tick();
            }
            long exceptionObservations = observed.stream()
                    .filter(o -> "ExceptionCount".equals(o.metric()))
                    .count();
            assertThat(exceptionObservations).isEqualTo(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING);

            Thread blocked = new Thread(() -> {
                throw new RuntimeException("blocked");
            });
            blocked.start();
            blocked.join();
            collector.tick();
            assertThat(observed.stream().filter(o -> "ExceptionCount".equals(o.metric())).count())
                    .isEqualTo(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING);

            collector.onFlushed();
            Thread afterFlush = new Thread(() -> {
                throw new RuntimeException("after-flush");
            });
            afterFlush.start();
            afterFlush.join();
            collector.tick();
            assertThat(observed.stream().filter(o -> "ExceptionCount".equals(o.metric())).count())
                    .isEqualTo(SystemMetricsCollector.SYSTEM_METRICS_MAX_PENDING + 1);
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void skipsNonFiniteValuesAndSwallowsSamplerFailures() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        AtomicBoolean throwOnce = new AtomicBoolean(true);
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    () -> {
                        if (throwOnce.getAndSet(false)) {
                            throw new IllegalStateException("sampler failed");
                        }
                        return List.of(
                                new SystemMetricsCollector.Observation("CpuUsage", Double.NaN),
                                new SystemMetricsCollector.Observation("CpuUsage", 2.0));
                    },
                    null,
                    scheduler);
            collector.start();
            collector.tick();
            collector.tick();
            assertThat(observed).containsExactly(new SystemMetricsCollector.Observation("CpuUsage", 2.0));
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void startIsIdempotentAndStopWithoutStartIsSafe() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    () -> List.of(new SystemMetricsCollector.Observation("CpuUsage", 1.0)),
                    null,
                    scheduler);
            collector.stop();
            collector.start();
            collector.start();
            collector.tick();
            assertThat(observed).hasSize(1);
            collector.stop();
            collector.stop();
        } finally {
            scheduler.shutdownNow();
        }
    }

    @Test
    void attachRestoresPreviousUncaughtHandlerOnStop() {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        AtomicBoolean priorInvoked = new AtomicBoolean();
        Thread.UncaughtExceptionHandler prior = (thread, ex) -> priorInvoked.set(true);
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(prior);
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> {},
                    10_000L,
                    () -> List.of(),
                    null,
                    scheduler);
            collector.start();
            Thread t = new Thread(() -> {
                throw new RuntimeException("chain");
            });
            t.start();
            t.join();
            assertThat(priorInvoked).isTrue();
            collector.stop();
            assertThat(Thread.getDefaultUncaughtExceptionHandler()).isSameAs(prior);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(before);
            scheduler.shutdownNow();
        }
    }

    @Test
    void stopDoesNotRestoreWhenDefaultHandlerReplaced() {
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> {},
                    10_000L,
                    () -> List.of(),
                    null,
                    scheduler);
            collector.start();
            Thread.UncaughtExceptionHandler replacement = (thread, ex) -> {};
            Thread.setDefaultUncaughtExceptionHandler(replacement);
            collector.stop();
            assertThat(Thread.getDefaultUncaughtExceptionHandler()).isSameAs(replacement);
        } finally {
            Thread.setDefaultUncaughtExceptionHandler(before);
            scheduler.shutdownNow();
        }
    }

    @Test
    void countsExceptionsWhenNoPriorUncaughtHandler() throws Exception {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
        Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(null);
        PrintStream originalErr = System.err;
        System.setErr(new PrintStream(new ByteArrayOutputStream()));
        try {
            SystemMetricsCollector collector = new SystemMetricsCollector(
                    (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)),
                    10_000L,
                    null,
                    System::nanoTime,
                    scheduler);
            collector.start();
            Thread t = new Thread(() -> {
                throw new RuntimeException("no-prior-handler");
            });
            t.start();
            t.join();
            collector.tick();
            assertThat(observed).contains(new SystemMetricsCollector.Observation("ExceptionCount", 1.0));
            collector.stop();
        } finally {
            System.setErr(originalErr);
            Thread.setDefaultUncaughtExceptionHandler(before);
            scheduler.shutdownNow();
        }
    }

    @Test
    void publicConstructorStartsAndStopsOwnedScheduler() {
        List<SystemMetricsCollector.Observation> observed = new ArrayList<>();
        SystemMetricsCollector collector = new SystemMetricsCollector(
                (metric, value) -> observed.add(new SystemMetricsCollector.Observation(metric, value)));
        collector.start();
        collector.tick();
        assertThat(observed).isNotEmpty();
        int emitted = observed.size();
        collector.stop();
        collector.tick();
        assertThat(observed).hasSize(emitted);
    }
}
