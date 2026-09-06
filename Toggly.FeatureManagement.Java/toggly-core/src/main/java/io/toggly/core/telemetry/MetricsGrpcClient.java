package io.toggly.core.telemetry;

/**
 * Client for {@code Metrics.SendMetrics}.
 */
public interface MetricsGrpcClient extends AutoCloseable {

    void sendMetrics(MetricStatPayload payload) throws Exception;

    @Override
    void close();
}
