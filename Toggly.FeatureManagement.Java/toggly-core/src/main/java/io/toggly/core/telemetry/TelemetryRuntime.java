package io.toggly.core.telemetry;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Owns usage + metrics batchers, flush timers, and shutdown flush.
 *
 * <p>gRPC transport is optional: when {@code grpc-netty-shaded} / {@code protobuf-java} are not on
 * the classpath, batching still works for tests via injected clients; otherwise a warning is
 * logged and sends are skipped.</p>
 */
public final class TelemetryRuntime implements AutoCloseable {

    public static final Duration DEFAULT_FLUSH_INTERVAL = Duration.ofMinutes(1);

    private static final Logger LOGGER = Logger.getLogger(TelemetryRuntime.class.getName());
    private static final String GRPC_FACTORY = "io.toggly.core.telemetry.GrpcClientFactory";

    private final String appKey;
    private final String environment;
    private final String metricsBaseUrl;
    private final boolean enableUsageTracking;
    private final boolean enableMetrics;
    private final Duration usageFlushInterval;
    private final Duration metricsFlushInterval;
    private final String instanceName;
    private final String appVersion;

    private UsageBatcher usageBatcher;
    private MetricsBatcher metricsBatcher;
    private GrpcClients clients;
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> usageFuture;
    private ScheduledFuture<?> metricsFuture;
    private final AtomicBoolean sendingUsage = new AtomicBoolean(false);
    private final AtomicBoolean sendingMetrics = new AtomicBoolean(false);
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private Thread shutdownHook;

    private UsageGrpcClient injectedUsageClient;
    private MetricsGrpcClient injectedMetricsClient;

    public TelemetryRuntime(Builder builder) {
        this.appKey = Objects.requireNonNull(builder.appKey, "appKey");
        this.environment = builder.environment != null ? builder.environment : "Production";
        this.metricsBaseUrl = builder.metricsBaseUrl != null
                ? builder.metricsBaseUrl
                : defaultMetricsBaseUrl();
        this.enableUsageTracking = builder.enableUsageTracking;
        this.enableMetrics = builder.enableMetrics;
        this.usageFlushInterval = builder.usageFlushInterval != null
                ? builder.usageFlushInterval
                : DEFAULT_FLUSH_INTERVAL;
        this.metricsFlushInterval = builder.metricsFlushInterval != null
                ? builder.metricsFlushInterval
                : DEFAULT_FLUSH_INTERVAL;
        this.instanceName = builder.instanceName;
        this.appVersion = builder.appVersion;
        this.injectedUsageClient = builder.usageClient;
        this.injectedMetricsClient = builder.metricsClient;
    }

    public static Builder builder() {
        return new Builder();
    }

    private static String defaultMetricsBaseUrl() {
        try {
            Class<?> factory = Class.forName(GRPC_FACTORY);
            return (String) factory.getField("DEFAULT_METRICS_BASE_URL").get(null);
        } catch (ReflectiveOperationException | LinkageError e) {
            return "https://app.toggly.io/";
        }
    }

    public boolean isUsageEnabled() {
        return enableUsageTracking && !closed.get();
    }

    public boolean isMetricsEnabled() {
        return enableMetrics && !closed.get();
    }

    public void start() {
        if (closed.get()) {
            return;
        }
        if (!enableUsageTracking && !enableMetrics) {
            return;
        }

        if (injectedUsageClient != null || injectedMetricsClient != null) {
            clients = new GrpcClients(injectedUsageClient, injectedMetricsClient);
        } else if (enableUsageTracking || enableMetrics) {
            clients = createGrpcClientsReflectively(metricsBaseUrl);
            if (clients == null) {
                LOGGER.warning(
                        "Usage/metrics enabled but gRPC dependencies are not on the classpath. "
                                + "Add optional deps grpc-netty-shaded, grpc-protobuf, grpc-stub, "
                                + "and protobuf-java to send telemetry.");
            }
        }

        if (enableUsageTracking) {
            usageBatcher = new UsageBatcher(appKey, environment, instanceName, appVersion);
        }
        if (enableMetrics) {
            metricsBatcher = new MetricsBatcher(appKey, environment, instanceName);
        }

        boolean needScheduler =
                (enableUsageTracking && usageFlushInterval.toMillis() > 0)
                        || (enableMetrics && metricsFlushInterval.toMillis() > 0);
        if (needScheduler) {
            scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "toggly-telemetry");
                t.setDaemon(true);
                return t;
            });
            if (enableUsageTracking && usageFlushInterval.toMillis() > 0) {
                usageFuture = scheduler.scheduleAtFixedRate(
                        this::flushUsageSafe,
                        usageFlushInterval.toMillis(),
                        usageFlushInterval.toMillis(),
                        TimeUnit.MILLISECONDS);
            }
            if (enableMetrics && metricsFlushInterval.toMillis() > 0) {
                metricsFuture = scheduler.scheduleAtFixedRate(
                        this::flushMetricsSafe,
                        metricsFlushInterval.toMillis(),
                        metricsFlushInterval.toMillis(),
                        TimeUnit.MILLISECONDS);
            }
        }

        attachShutdownHook();
    }

    private void attachShutdownHook() {
        shutdownHook = new Thread(() -> {
            try {
                close();
            } catch (Exception e) {
                LOGGER.log(Level.FINE, "Shutdown flush failed", e);
            }
        }, "toggly-telemetry-shutdown");
        try {
            Runtime.getRuntime().addShutdownHook(shutdownHook);
        } catch (IllegalStateException e) {
            // JVM already shutting down
        }
    }

    private void detachShutdownHook() {
        if (shutdownHook == null) {
            return;
        }
        try {
            Runtime.getRuntime().removeShutdownHook(shutdownHook);
        } catch (IllegalStateException ignored) {
            // already shutting down
        }
        shutdownHook = null;
    }

    public void recordCheck(String feature, boolean enabled, String identity) {
        if (usageBatcher != null) {
            usageBatcher.recordCheck(feature, enabled, identity);
        }
    }

    public void recordCheck(
            String feature, boolean enabled, String identity, String variant, boolean uniqueRequest) {
        if (usageBatcher != null) {
            usageBatcher.recordCheck(feature, enabled, identity, variant, uniqueRequest);
        }
    }

    public void recordUsage(String feature, String identity) {
        if (usageBatcher != null) {
            usageBatcher.recordUsage(feature, identity);
        }
    }

    public void recordUsage(String feature, String identity, String variant) {
        if (usageBatcher != null) {
            usageBatcher.recordUsage(feature, identity, variant);
        }
    }

    public void recordView(String feature, String identity) {
        if (usageBatcher != null) {
            usageBatcher.recordView(feature, identity);
        }
    }

    public void recordView(String feature, String identity, String variant) {
        if (usageBatcher != null) {
            usageBatcher.recordView(feature, identity, variant);
        }
    }

    public void measure(String metric, double value, MetricsFeatureOptions options) {
        if (metricsBatcher != null) {
            metricsBatcher.measure(metric, value, options);
        }
    }

    public void incrementCounter(String metric, double value, MetricsFeatureOptions options) {
        if (metricsBatcher != null) {
            metricsBatcher.incrementCounter(metric, value, options);
        }
    }

    public void observe(String metric, double value, MetricsFeatureOptions options) {
        if (metricsBatcher != null) {
            metricsBatcher.observe(metric, value, options);
        }
    }

    public void flushUsage() {
        if (usageBatcher == null || !sendingUsage.compareAndSet(false, true)) {
            return;
        }
        try {
            UsageGrpcClient client = clients != null ? clients.usage() : null;
            if (client == null) {
                LOGGER.fine("Usage flush skipped: no gRPC client");
                return;
            }
            FeatureStatPayload payload = usageBatcher.buildAndReset();
            if (payload == null) {
                return;
            }
            client.sendStats(payload);
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Failed to send usage stats", e);
        } finally {
            sendingUsage.set(false);
        }
    }

    public void flushMetrics() {
        if (metricsBatcher == null || !sendingMetrics.compareAndSet(false, true)) {
            return;
        }
        try {
            MetricsGrpcClient client = clients != null ? clients.metrics() : null;
            if (client == null) {
                LOGGER.fine("Metrics flush skipped: no gRPC client");
                return;
            }
            MetricStatPayload payload = metricsBatcher.buildAndReset();
            if (payload == null) {
                return;
            }
            client.sendMetrics(payload);
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Failed to send metrics", e);
        } finally {
            sendingMetrics.set(false);
        }
    }

    public void flushAll() {
        flushUsage();
        flushMetrics();
    }

    private void flushUsageSafe() {
        try {
            flushUsage();
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Scheduled usage flush failed", e);
        }
    }

    private void flushMetricsSafe() {
        try {
            flushMetrics();
        } catch (Exception e) {
            LOGGER.log(Level.WARNING, "Scheduled metrics flush failed", e);
        }
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        if (usageFuture != null) {
            usageFuture.cancel(false);
            usageFuture = null;
        }
        if (metricsFuture != null) {
            metricsFuture.cancel(false);
            metricsFuture = null;
        }
        if (scheduler != null) {
            scheduler.shutdown();
            try {
                if (!scheduler.awaitTermination(2, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
            scheduler = null;
        }

        detachShutdownHook();

        try {
            flushAll();
        } finally {
            if (clients != null) {
                clients.close();
                clients = null;
            }
            usageBatcher = null;
            metricsBatcher = null;
        }
    }

    @SuppressWarnings("unchecked")
    private static GrpcClients createGrpcClientsReflectively(String metricsBaseUrl) {
        try {
            Class<?> factory = Class.forName(GRPC_FACTORY);
            Method create = factory.getMethod("create", String.class);
            return (GrpcClients) create.invoke(null, metricsBaseUrl);
        } catch (ClassNotFoundException | LinkageError e) {
            return null;
        } catch (ReflectiveOperationException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            if (cause instanceof LinkageError) {
                return null;
            }
            LOGGER.log(Level.WARNING, "Failed to create Toggly gRPC clients; telemetry send disabled", e);
            return null;
        }
    }

    public static final class Builder {
        private String appKey;
        private String environment = "Production";
        private String metricsBaseUrl;
        private boolean enableUsageTracking = true;
        private boolean enableMetrics = true;
        private Duration usageFlushInterval;
        private Duration metricsFlushInterval;
        private String instanceName;
        private String appVersion;
        private UsageGrpcClient usageClient;
        private MetricsGrpcClient metricsClient;

        public Builder appKey(String appKey) {
            this.appKey = appKey;
            return this;
        }

        public Builder environment(String environment) {
            this.environment = environment;
            return this;
        }

        public Builder metricsBaseUrl(String metricsBaseUrl) {
            this.metricsBaseUrl = metricsBaseUrl;
            return this;
        }

        public Builder enableUsageTracking(boolean enableUsageTracking) {
            this.enableUsageTracking = enableUsageTracking;
            return this;
        }

        public Builder enableMetrics(boolean enableMetrics) {
            this.enableMetrics = enableMetrics;
            return this;
        }

        public Builder usageFlushInterval(Duration usageFlushInterval) {
            this.usageFlushInterval = usageFlushInterval;
            return this;
        }

        public Builder metricsFlushInterval(Duration metricsFlushInterval) {
            this.metricsFlushInterval = metricsFlushInterval;
            return this;
        }

        public Builder instanceName(String instanceName) {
            this.instanceName = instanceName;
            return this;
        }

        public Builder appVersion(String appVersion) {
            this.appVersion = appVersion;
            return this;
        }

        /** Injected for tests; when set, skips classpath gRPC dial. */
        public Builder usageClient(UsageGrpcClient usageClient) {
            this.usageClient = usageClient;
            return this;
        }

        public Builder metricsClient(MetricsGrpcClient metricsClient) {
            this.metricsClient = metricsClient;
            return this;
        }

        public TelemetryRuntime build() {
            return new TelemetryRuntime(this);
        }
    }
}
