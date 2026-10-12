package io.toggly.core.telemetry;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;

import com.sun.management.OperatingSystemMXBean;

/**
 * Opt-in JVM process metrics: CpuUsage, MemoryWorkingSet (Linux VmRSS), GCHeapSize,
 * AllocationRate, TimeInGC, ExceptionCount (uncaught). Samples every 10s by default.
 */
public final class SystemMetricsCollector {

    public static final long SYSTEM_METRICS_INTERVAL_MS = 10_000L;
    public static final int SYSTEM_METRICS_MAX_PENDING = 30;

    @FunctionalInterface
    public interface Observe {
        void observe(String metric, double value);
    }

    @FunctionalInterface
    public interface Sampler {
        List<Observation> sample();
    }

    public record Observation(String metric, double value) {}

    private final Observe observe;
    private final long intervalMs;
    private final Sampler sampler;
    private final LongSupplier nanoTime;
    private final ScheduledExecutorService scheduler;
    private final boolean ownsScheduler;

    private ScheduledFuture<?> future;
    private volatile boolean started;
    private final Map<String, Integer> pendingByMetric = new ConcurrentHashMap<>();
    private final AtomicInteger exceptionCount = new AtomicInteger();
    private Thread.UncaughtExceptionHandler previousUncaughtHandler;

    private CpuSnapshot lastCpu;
    private long lastGcTimeMs = -1L;
    private long lastHeapUsed = -1L;
    private long lastSampleWallMs = -1L;

    public SystemMetricsCollector(Observe observe) {
        this(observe, SYSTEM_METRICS_INTERVAL_MS, null, null, null);
    }

    SystemMetricsCollector(
            Observe observe,
            long intervalMs,
            Sampler sampler,
            LongSupplier nanoTime,
            ScheduledExecutorService scheduler) {
        this.observe = observe;
        this.intervalMs = intervalMs > 0 ? intervalMs : SYSTEM_METRICS_INTERVAL_MS;
        this.sampler = sampler != null ? sampler : this::defaultSample;
        this.nanoTime = nanoTime != null ? nanoTime : System::nanoTime;
        if (scheduler != null) {
            this.scheduler = scheduler;
            this.ownsScheduler = false;
        } else {
            this.scheduler = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "toggly-system-metrics");
                t.setDaemon(true);
                return t;
            });
            this.ownsScheduler = true;
        }
    }

    public void start() {
        if (started) {
            return;
        }
        started = true;
        lastCpu = readCpuSnapshot();
        lastGcTimeMs = totalGcCollectionTimeMs();
        lastHeapUsed = currentHeapUsedBytes();
        lastSampleWallMs = System.currentTimeMillis();
        attachUncaughtHandler();
        future = scheduler.scheduleAtFixedRate(
                this::tickSafe,
                intervalMs,
                intervalMs,
                TimeUnit.MILLISECONDS);
    }

    public void stop() {
        if (!started) {
            return;
        }
        started = false;
        if (future != null) {
            future.cancel(false);
            future = null;
        }
        detachUncaughtHandler();
        pendingByMetric.clear();
        if (ownsScheduler) {
            scheduler.shutdownNow();
        }
    }

    /** Test helper: run one sample cycle immediately. */
    public void tick() {
        if (!started) {
            return;
        }
        try {
            List<Observation> samples = sampler.sample();
            for (Observation sample : samples) {
                if (!Double.isFinite(sample.value())) {
                    continue;
                }
                int pending = pendingByMetric.getOrDefault(sample.metric(), 0);
                if (pending >= SYSTEM_METRICS_MAX_PENDING) {
                    continue;
                }
                pendingByMetric.put(sample.metric(), pending + 1);
                observe.observe(sample.metric(), sample.value());
            }
        } catch (RuntimeException ignored) {
            // Never disrupt the host process.
        }
    }

    /** Call after a successful metrics flush to free the pending cap. */
    public void onFlushed() {
        pendingByMetric.clear();
    }

    private void tickSafe() {
        try {
            tick();
        } catch (RuntimeException ignored) {
            // Never disrupt the host process.
        }
    }

    private List<Observation> defaultSample() {
        List<Observation> out = new ArrayList<>();
        long nowMs = System.currentTimeMillis();
        double intervalSec = lastSampleWallMs > 0
                ? Math.max(0.001, (nowMs - lastSampleWallMs) / 1000.0)
                : intervalMs / 1000.0;
        lastSampleWallMs = nowMs;

        Double cpu = sampleCpuPercent();
        if (cpu != null) {
            out.add(new Observation("CpuUsage", cpu));
        }

        Long rss = readLinuxVmRssBytes();
        if (rss != null) {
            out.add(new Observation("MemoryWorkingSet", rss));
        }

        long heapUsed = currentHeapUsedBytes();
        if (heapUsed >= 0) {
            out.add(new Observation("GCHeapSize", heapUsed));
        }

        if (lastHeapUsed >= 0 && heapUsed > lastHeapUsed && intervalSec > 0) {
            double rate = (heapUsed - lastHeapUsed) / intervalSec;
            if (Double.isFinite(rate) && rate > 0) {
                out.add(new Observation("AllocationRate", rate));
            }
        }
        lastHeapUsed = heapUsed;

        Double timeInGc = sampleTimeInGcPercent(intervalSec);
        if (timeInGc != null) {
            out.add(new Observation("TimeInGC", timeInGc));
        }

        int exceptions = exceptionCount.getAndSet(0);
        if (exceptions > 0) {
            out.add(new Observation("ExceptionCount", exceptions));
        }

        return out;
    }

    private Double sampleCpuPercent() {
        CpuSnapshot current = readCpuSnapshot();
        if (current == null) {
            return null;
        }
        CpuSnapshot prev = lastCpu;
        lastCpu = current;
        if (prev == null) {
            return null;
        }
        long wallNs = current.nanoTime - prev.nanoTime;
        if (wallNs <= 0) {
            return null;
        }
        long cpuNs = current.processCpuTimeNs - prev.processCpuTimeNs;
        if (cpuNs < 0) {
            return null;
        }
        int processors = Math.max(1, Runtime.getRuntime().availableProcessors());
        double pct = (cpuNs * 100.0 / wallNs) / processors;
        if (!Double.isFinite(pct) || pct < 0) {
            return null;
        }
        return Math.min(100.0, pct);
    }

    private CpuSnapshot readCpuSnapshot() {
        try {
            OperatingSystemMXBean os =
                    (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
            long cpuTime = os.getProcessCpuTime();
            if (cpuTime < 0) {
                return null;
            }
            return new CpuSnapshot(cpuTime, nanoTime.getAsLong());
        } catch (ClassCastException | LinkageError ignored) {
            return null;
        }
    }

    private static long currentHeapUsedBytes() {
        try {
            MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
            long used = heap.getUsed();
            return used >= 0 ? used : -1L;
        } catch (RuntimeException ignored) {
            return -1L;
        }
    }

    private static long totalGcCollectionTimeMs() {
        long total = 0;
        for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
            long t = gc.getCollectionTime();
            if (t >= 0) {
                total += t;
            }
        }
        return total;
    }

    private Double sampleTimeInGcPercent(double intervalSec) {
        long gcMs = totalGcCollectionTimeMs();
        if (lastGcTimeMs < 0) {
            lastGcTimeMs = gcMs;
            return null;
        }
        long delta = gcMs - lastGcTimeMs;
        lastGcTimeMs = gcMs;
        if (delta <= 0 || intervalSec <= 0) {
            return null;
        }
        double pct = (delta / (intervalSec * 1000.0)) * 100.0;
        if (!Double.isFinite(pct) || pct < 0) {
            return null;
        }
        return Math.min(100.0, pct);
    }

    static Long readLinuxVmRssBytes() {
        if (!"Linux".equalsIgnoreCase(System.getProperty("os.name"))) {
            return null;
        }
        Path status = Path.of("/proc/self/status");
        try {
            if (!Files.isRegularFile(status)) {
                return null;
            }
            for (String line : Files.readAllLines(status)) {
                if (!line.startsWith("VmRSS:")) {
                    continue;
                }
                String digits = line.replace("VmRSS:", "").trim();
                int space = digits.indexOf(' ');
                if (space > 0) {
                    digits = digits.substring(0, space);
                }
                long kb = Long.parseLong(digits.trim());
                if (kb < 0) {
                    return null;
                }
                return kb * 1024L;
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private void attachUncaughtHandler() {
        try {
            Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
            previousUncaughtHandler = previous;
            Thread.setDefaultUncaughtExceptionHandler((thread, ex) -> {
                exceptionCount.incrementAndGet();
                if (previous != null) {
                    previous.uncaughtException(thread, ex);
                }
            });
        } catch (RuntimeException ignored) {
            previousUncaughtHandler = null;
        }
    }

    private void detachUncaughtHandler() {
        try {
            Thread.setDefaultUncaughtExceptionHandler(previousUncaughtHandler);
        } catch (RuntimeException ignored) {
            // ignore
        }
        previousUncaughtHandler = null;
    }

    private record CpuSnapshot(long processCpuTimeNs, long nanoTime) {}
}
