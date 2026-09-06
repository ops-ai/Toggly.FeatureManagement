package io.toggly.core.telemetry;

/**
 * Client for {@code Usage.SendStats}.
 */
public interface UsageGrpcClient extends AutoCloseable {

    void sendStats(FeatureStatPayload payload) throws Exception;

    @Override
    void close();
}
