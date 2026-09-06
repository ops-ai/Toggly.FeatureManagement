package io.toggly.core.telemetry;

/**
 * Pair of usage + metrics gRPC clients.
 */
public class GrpcClients implements AutoCloseable {

    private final UsageGrpcClient usage;
    private final MetricsGrpcClient metrics;
    private final Runnable onClose;

    public GrpcClients(UsageGrpcClient usage, MetricsGrpcClient metrics) {
        this(usage, metrics, null);
    }

    public GrpcClients(UsageGrpcClient usage, MetricsGrpcClient metrics, Runnable onClose) {
        this.usage = usage;
        this.metrics = metrics;
        this.onClose = onClose;
    }

    public UsageGrpcClient usage() {
        return usage;
    }

    public MetricsGrpcClient metrics() {
        return metrics;
    }

    @Override
    public void close() {
        try {
            if (usage != null) {
                usage.close();
            }
        } catch (Exception ignored) {
            // best-effort
        }
        try {
            if (metrics != null) {
                metrics.close();
            }
        } catch (Exception ignored) {
            // best-effort
        }
        if (onClose != null) {
            try {
                onClose.run();
            } catch (Exception ignored) {
                // best-effort
            }
        }
    }
}
