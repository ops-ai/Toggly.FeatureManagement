package io.toggly.core.telemetry;

import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;
import io.toggly.core.SdkIdentity;
import io.toggly.core.telemetry.pb.metrics.MetricResult;
import io.toggly.core.telemetry.pb.metrics.MetricStat;
import io.toggly.core.telemetry.pb.metrics.MetricsGrpc;
import io.toggly.core.telemetry.pb.usage.FeatureStat;
import io.toggly.core.telemetry.pb.usage.StatResult;
import io.toggly.core.telemetry.pb.usage.UsageGrpc;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Contract-level coverage: protobuf payload shape, generated RPC wiring
 * ({@code Usage.SendStats} / {@code Metrics.SendMetrics}), and {@code UA} metadata.
 */
class GrpcContractTest {

    private static final Metadata.Key<String> UA_KEY =
            Metadata.Key.of("UA", Metadata.ASCII_STRING_MARSHALLER);

    private String serverName;
    private Server server;
    private ManagedChannel channel;
    private final AtomicReference<FeatureStat> lastUsage = new AtomicReference<>();
    private final AtomicReference<MetricStat> lastMetrics = new AtomicReference<>();
    private final AtomicReference<String> lastUa = new AtomicReference<>();

    @BeforeEach
    void startInProcessServer() throws Exception {
        serverName = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(serverName)
                .directExecutor()
                .intercept(new ServerInterceptor() {
                    @Override
                    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                            ServerCall<ReqT, RespT> call,
                            Metadata headers,
                            ServerCallHandler<ReqT, RespT> next) {
                        lastUa.set(headers.get(UA_KEY));
                        return next.startCall(call, headers);
                    }
                })
                .addService(new UsageGrpc.UsageImplBase() {
                    @Override
                    public void sendStats(FeatureStat request, StreamObserver<StatResult> responseObserver) {
                        lastUsage.set(request);
                        responseObserver.onNext(StatResult.newBuilder().setFeatureCount(1).build());
                        responseObserver.onCompleted();
                    }
                })
                .addService(new MetricsGrpc.MetricsImplBase() {
                    @Override
                    public void sendMetrics(
                            MetricStat request, StreamObserver<MetricResult> responseObserver) {
                        lastMetrics.set(request);
                        responseObserver.onNext(MetricResult.newBuilder().setCount(1).build());
                        responseObserver.onCompleted();
                    }
                })
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(serverName).directExecutor().build();
    }

    @AfterEach
    void tearDown() {
        if (channel != null) {
            channel.shutdownNow();
        }
        if (server != null) {
            server.shutdownNow();
        }
    }

    @Test
    void toProtoMapsUsageVariantStatsAndMetricsVariantValues() {
        Instant now = Instant.parse("2026-09-06T12:00:00Z");
        FeatureStatPayload usagePayload = new FeatureStatPayload(
                "app-key",
                "Production",
                now,
                List.of(new FeatureStatPayload.StatMessage(
                        "FeatureA",
                        1,
                        1,
                        1,
                        List.of(IdentityHasher.hashIdentity("user-1")),
                        List.of(IdentityHasher.hashIdentity("user-3")),
                        Map.of(
                                "enabled", new FeatureStatPayload.VariantStats(2, 1, 1, 1),
                                "disabled", new FeatureStatPayload.VariantStats(1, 1, 0, 0)))),
                2,
                List.of(
                        IdentityHasher.hashIdentity("user-1"),
                        IdentityHasher.hashIdentity("user-2")),
                "host-1",
                "1.4.0",
                Instant.parse("2026-09-06T11:00:00Z"));

        FeatureStat usageProto = GrpcClientFactory.toProto(usagePayload);
        assertThat(usageProto.getAppKey()).isEqualTo("app-key");
        assertThat(usageProto.getEnvironment()).isEqualTo("Production");
        assertThat(usageProto.getInstanceName()).isEqualTo("host-1");
        assertThat(usageProto.getAppVersion()).isEqualTo("1.4.0");
        assertThat(usageProto.hasDefinitionCacheHits()).isFalse();
        assertThat(usageProto.hasDefinitionCacheMisses()).isFalse();
        assertThat(usageProto.getStatsCount()).isEqualTo(1);
        assertThat(usageProto.getStats(0).getVariantStatsMap().get("enabled").getCheckCount()).isEqualTo(2);
        assertThat(usageProto.getStats(0).getVariantStatsMap().get("enabled").getUsedCount()).isEqualTo(1);
        assertThat(usageProto.getStats(0).getVariantStatsMap().get("disabled").getCheckCount()).isEqualTo(1);
        assertThat(usageProto.getUniqueUserHashesList()).hasSize(2);

        FeatureStatPayload withCache = new FeatureStatPayload(
                "app-key",
                "Production",
                now,
                List.of(),
                0,
                List.of(),
                null,
                null,
                null,
                4,
                2);
        FeatureStat cacheProto = GrpcClientFactory.toProto(withCache);
        assertThat(cacheProto.getDefinitionCacheHits()).isEqualTo(4);
        assertThat(cacheProto.getDefinitionCacheMisses()).isEqualTo(2);

        MetricStatPayload metricsPayload = new MetricStatPayload(
                "app-key",
                "Production",
                now,
                List.of(new MetricStatPayload.MetricValues(
                        "revenue", "FeatureA", Map.of("enabled", 13.0))),
                List.of(new MetricStatPayload.MetricValues(
                        "clicks", "FeatureA", Map.of("variant_a", 3.0))),
                List.of(new MetricStatPayload.ObservationMessage(
                        now, "temperature", null, Map.of("enabled", 72.0))),
                "host-1");

        MetricStat metricsProto = GrpcClientFactory.toProto(metricsPayload);
        assertThat(metricsProto.getInstanceName()).isEqualTo("host-1");
        assertThat(metricsProto.getStats(0).getVariantValuesMap()).containsEntry("enabled", 13.0);
        assertThat(metricsProto.getCounters(0).getVariantValuesMap()).containsEntry("variant_a", 3.0);
        assertThat(metricsProto.getObservations(0).getVariantValuesMap()).containsEntry("enabled", 72.0);
    }

    @Test
    void generatedStubsWireSendStatsAndSendMetricsWithUaMetadata() throws Exception {
        String customUa = "toggly-java-contract-test/1.4.0";
        GrpcClients clients = GrpcClientFactory.createWithChannel(channel, customUa, false);
        assertThat(clients).isNotNull();

        Instant now = Instant.parse("2026-09-06T12:00:00Z");
        FeatureStatPayload usagePayload = new FeatureStatPayload(
                "app",
                "Test",
                now,
                List.of(new FeatureStatPayload.StatMessage(
                        "FeatureA",
                        1,
                        0,
                        0,
                        List.of(),
                        List.of(),
                        Map.of("enabled", new FeatureStatPayload.VariantStats(1, 0, 0, 0)))),
                1,
                List.of(IdentityHasher.hashIdentity("u1")),
                "instance-a",
                "9.9.9",
                null);
        MetricStatPayload metricsPayload = new MetricStatPayload(
                "app",
                "Test",
                now,
                List.of(new MetricStatPayload.MetricValues(
                        "m1", "FeatureA", Map.of("enabled", 1.5))),
                List.of(),
                List.of(),
                "instance-a");

        clients.usage().sendStats(usagePayload);
        assertThat(lastUsage.get()).isNotNull();
        assertThat(lastUsage.get().getStats(0).getVariantStatsMap().get("enabled").getCheckCount())
                .isEqualTo(1);
        assertThat(lastUsage.get().getInstanceName()).isEqualTo("instance-a");
        assertThat(lastUsage.get().getAppVersion()).isEqualTo("9.9.9");
        assertThat(lastUa.get()).isEqualTo(customUa);

        lastUa.set(null);
        clients.metrics().sendMetrics(metricsPayload);
        assertThat(lastMetrics.get()).isNotNull();
        assertThat(lastMetrics.get().getStats(0).getVariantValuesMap()).containsEntry("enabled", 1.5);
        assertThat(lastMetrics.get().getInstanceName()).isEqualTo("instance-a");
        assertThat(lastUa.get()).isEqualTo(customUa);

        clients.close();
    }

    @Test
    void defaultCreatePathAttachesSdkIdentityUserAgent() throws Exception {
        // Prove the same UA key/interceptor path used by create() when a custom UA is omitted.
        GrpcClients clients =
                GrpcClientFactory.createWithChannel(channel, SdkIdentity.userAgent(), false);
        clients.usage().sendStats(new FeatureStatPayload(
                "app",
                "Test",
                Instant.now(),
                List.of(new FeatureStatPayload.StatMessage(
                        "F",
                        0,
                        0,
                        0,
                        List.of(),
                        List.of(),
                        Map.of("enabled", new FeatureStatPayload.VariantStats(1, 0, 0, 0)))),
                0,
                List.of(),
                null,
                null,
                null));

        assertThat(lastUa.get()).isEqualTo(SdkIdentity.userAgent());
        assertThat(lastUa.get()).startsWith("toggly-java/");
        clients.close();
    }
}
