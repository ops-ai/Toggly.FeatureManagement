package io.toggly.core.telemetry;

import com.google.protobuf.Timestamp;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import io.toggly.core.SdkIdentity;
import io.toggly.core.telemetry.pb.metrics.MetricCounterMessage;
import io.toggly.core.telemetry.pb.metrics.MetricObservationMessage;
import io.toggly.core.telemetry.pb.metrics.MetricStat;
import io.toggly.core.telemetry.pb.metrics.MetricStatMessage;
import io.toggly.core.telemetry.pb.metrics.MetricsGrpc;
import io.toggly.core.telemetry.pb.usage.FeatureStat;
import io.toggly.core.telemetry.pb.usage.StatMessage;
import io.toggly.core.telemetry.pb.usage.UsageGrpc;
import io.toggly.core.telemetry.pb.usage.VariantStats;

import java.net.URI;
import java.time.Instant;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Native gRPC transport for usage and business metrics.
 *
 * <p>Requires optional Maven dependencies ({@code grpc-netty-shaded}, {@code grpc-protobuf},
 * {@code grpc-stub}, {@code protobuf-java}) on the classpath. Call
 * {@link #isAvailable()} before {@link #create(String)}.</p>
 */
public final class GrpcClientFactory {

    public static final String DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/";

    private static final Logger LOGGER = Logger.getLogger(GrpcClientFactory.class.getName());
    private static final Metadata.Key<String> UA_KEY =
            Metadata.Key.of("UA", Metadata.ASCII_STRING_MARSHALLER);

    private GrpcClientFactory() {
    }

    /**
     * Returns true when gRPC classes are present on the classpath.
     */
    public static boolean isAvailable() {
        try {
            Class.forName("io.grpc.ManagedChannelBuilder");
            Class.forName("com.google.protobuf.Message");
            return true;
        } catch (ClassNotFoundException | LinkageError e) {
            return false;
        }
    }

    /**
     * Creates usage + metrics clients against {@code metricsBaseUrl}, or {@code null} if gRPC is
     * unavailable.
     */
    public static GrpcClients create(String metricsBaseUrl) {
        return create(metricsBaseUrl, SdkIdentity.userAgent());
    }

    public static GrpcClients create(String metricsBaseUrl, String userAgent) {
        if (!isAvailable()) {
            return null;
        }
        try {
            String target = grpcTarget(metricsBaseUrl != null ? metricsBaseUrl : DEFAULT_METRICS_BASE_URL);
            String ua = userAgent != null && !userAgent.isEmpty() ? userAgent : SdkIdentity.userAgent();

            ManagedChannel channel = ManagedChannelBuilder.forTarget(target)
                    .useTransportSecurity()
                    .build();

            return createWithChannel(channel, ua, true);
        } catch (LinkageError e) {
            LOGGER.log(Level.WARNING, "gRPC classes present but failed to initialize", e);
            return null;
        }
    }

    /**
     * Builds usage/metrics clients on an existing channel (used by production create and
     * in-process contract tests). Attaches {@code UA} metadata on both stubs.
     *
     * @param channel managed channel (caller owns lifecycle when {@code shutdownChannel} is false)
     * @param userAgent value for the {@code UA} metadata key
     * @param shutdownChannel whether {@link GrpcClients#close()} should shut down the channel
     */
    static GrpcClients createWithChannel(
            ManagedChannel channel, String userAgent, boolean shutdownChannel) {
        String ua = userAgent != null && !userAgent.isEmpty() ? userAgent : SdkIdentity.userAgent();

        Metadata metadata = new Metadata();
        metadata.put(UA_KEY, ua);

        UsageGrpc.UsageBlockingStub usageStub = UsageGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));
        MetricsGrpc.MetricsBlockingStub metricsStub = MetricsGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));

        UsageGrpcClient usage = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) {
                usageStub.withDeadlineAfter(5, TimeUnit.SECONDS).sendStats(toProto(payload));
            }

            @Override
            public void close() {
                // channel shared; closed via GrpcClients
            }
        };

        MetricsGrpcClient metrics = new MetricsGrpcClient() {
            @Override
            public void sendMetrics(MetricStatPayload payload) {
                metricsStub.withDeadlineAfter(5, TimeUnit.SECONDS).sendMetrics(toProto(payload));
            }

            @Override
            public void close() {
                // channel shared
            }
        };

        Runnable onClose = shutdownChannel
                ? () -> {
                    try {
                        channel.shutdown();
                        if (!channel.awaitTermination(2, TimeUnit.SECONDS)) {
                            channel.shutdownNow();
                        }
                    } catch (InterruptedException e) {
                        channel.shutdownNow();
                        Thread.currentThread().interrupt();
                    } catch (Exception e) {
                        LOGGER.log(Level.FINE, "Error closing gRPC channel", e);
                    }
                }
                : null;

        return new GrpcClients(usage, metrics, onClose);
    }

    /**
     * Parses a metrics base URL into a gRPC {@code host:port} target.
     */
    public static String grpcTarget(String baseUrl) {
        try {
            String raw = baseUrl.contains("://") ? baseUrl : "https://" + baseUrl;
            URI uri = URI.create(raw);
            String host = uri.getHost();
            if (host == null || host.isEmpty()) {
                throw new IllegalArgumentException("missing host");
            }
            int port = uri.getPort();
            if (port < 0) {
                port = 443;
            }
            return host + ":" + port;
        } catch (Exception e) {
            String trimmed = baseUrl.replaceFirst("^https?://", "").replaceAll("/$", "");
            return trimmed.contains(":") ? trimmed : trimmed + ":443";
        }
    }

    static FeatureStat toProto(FeatureStatPayload payload) {
        FeatureStat.Builder builder = FeatureStat.newBuilder()
                .setAppKey(payload.getAppKey())
                .setEnvironment(payload.getEnvironment())
                .setTime(toTimestamp(payload.getTime()))
                .setTotalUniqueUsers(payload.getTotalUniqueUsers())
                .addAllUniqueUserHashes(payload.getUniqueUserHashes());

        if (payload.getInstanceName() != null && !payload.getInstanceName().isEmpty()) {
            builder.setInstanceName(payload.getInstanceName());
        }
        if (payload.getAppVersion() != null && !payload.getAppVersion().isEmpty()) {
            builder.setAppVersion(payload.getAppVersion());
        }
        if (payload.getProcessStartTime() != null) {
            builder.setProcessStartTime(toTimestamp(payload.getProcessStartTime()));
        }

        for (FeatureStatPayload.StatMessage stat : payload.getStats()) {
            StatMessage.Builder sm = StatMessage.newBuilder()
                    .setFeature(stat.getFeature())
                    .setUniqueContextIdentifierEnabledCount(stat.getUniqueContextIdentifierEnabledCount())
                    .setUniqueContextIdentifierDisabledCount(stat.getUniqueContextIdentifierDisabledCount())
                    .setUniqueUsersUsedCount(stat.getUniqueUsersUsedCount())
                    .addAllUniqueUserHashes(stat.getUniqueUserHashes())
                    .addAllUniqueViewedUserHashes(stat.getUniqueViewedUserHashes());
            for (var entry : stat.getVariantStats().entrySet()) {
                FeatureStatPayload.VariantStats vs = entry.getValue();
                sm.putVariantStats(
                        entry.getKey(),
                        VariantStats.newBuilder()
                                .setCheckCount(vs.getCheckCount())
                                .setRequestCount(vs.getRequestCount())
                                .setUsedCount(vs.getUsedCount())
                                .setViewedCount(vs.getViewedCount())
                                .build());
            }
            builder.addStats(sm);
        }
        return builder.build();
    }

    static MetricStat toProto(MetricStatPayload payload) {
        MetricStat.Builder builder = MetricStat.newBuilder()
                .setAppKey(payload.getAppKey())
                .setEnvironment(payload.getEnvironment())
                .setTime(toTimestamp(payload.getTime()));

        if (payload.getInstanceName() != null && !payload.getInstanceName().isEmpty()) {
            builder.setInstanceName(payload.getInstanceName());
        }

        for (MetricStatPayload.MetricValues values : payload.getStats()) {
            MetricStatMessage.Builder msg = MetricStatMessage.newBuilder()
                    .setMetric(values.getMetric())
                    .putAllVariantValues(values.getVariantValues());
            if (values.getFeature() != null && !values.getFeature().isEmpty()) {
                msg.setFeature(values.getFeature());
            }
            builder.addStats(msg);
        }
        for (MetricStatPayload.MetricValues values : payload.getCounters()) {
            MetricCounterMessage.Builder msg = MetricCounterMessage.newBuilder()
                    .setMetric(values.getMetric())
                    .putAllVariantValues(values.getVariantValues());
            if (values.getFeature() != null && !values.getFeature().isEmpty()) {
                msg.setFeature(values.getFeature());
            }
            builder.addCounters(msg);
        }
        for (MetricStatPayload.ObservationMessage obs : payload.getObservations()) {
            MetricObservationMessage.Builder msg = MetricObservationMessage.newBuilder()
                    .setTime(toTimestamp(obs.getTime()))
                    .setMetric(obs.getMetric())
                    .putAllVariantValues(obs.getVariantValues());
            if (obs.getFeature() != null && !obs.getFeature().isEmpty()) {
                msg.setFeature(obs.getFeature());
            }
            builder.addObservations(msg);
        }
        return builder.build();
    }

    private static Timestamp toTimestamp(Instant instant) {
        return Timestamp.newBuilder()
                .setSeconds(instant.getEpochSecond())
                .setNanos(instant.getNano())
                .build();
    }
}
