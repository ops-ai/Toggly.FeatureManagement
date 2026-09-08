package io.toggly.core.snapshot;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.telemetry.FeatureStatPayload;
import io.toggly.core.telemetry.TelemetryRuntime;
import io.toggly.core.telemetry.UsageGrpcClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class DefinitionCacheHitsTest {

    private HttpServer server;
    private String baseUrl;
    private final AtomicInteger statusCode = new AtomicInteger(200);
    private final AtomicReference<String> etag = new AtomicReference<>("\"rev-1\"");
    private final AtomicReference<String> body = new AtomicReference<>(
            "[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");
    private final AtomicInteger requestCount = new AtomicInteger();
    private CountDownLatch holdFirstRequest;
    private CountDownLatch firstRequestStarted;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        requestCount.set(0);
        holdFirstRequest = null;
        firstRequestStarted = null;
        statusCode.set(200);
        etag.set("\"rev-1\"");
        body.set("[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        int n = requestCount.incrementAndGet();
        if (n == 1 && firstRequestStarted != null) {
            firstRequestStarted.countDown();
        }
        if (n == 1 && holdFirstRequest != null) {
            try {
                holdFirstRequest.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        int code = statusCode.get();
        String tag = etag.get();
        byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
        if (tag != null) {
            exchange.getResponseHeaders().add("ETag", tag);
        }
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        if (code == 304) {
            exchange.sendResponseHeaders(304, -1);
            exchange.close();
            return;
        }
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private TelemetryRuntime runtime(List<FeatureStatPayload> sent) {
        UsageGrpcClient usageClient = new UsageGrpcClient() {
            @Override
            public void sendStats(FeatureStatPayload payload) {
                sent.add(payload);
            }

            @Override
            public void close() {
            }
        };
        TelemetryRuntime runtime = TelemetryRuntime.builder()
                .appKey("test-app")
                .environment("Production")
                .enableUsageTracking(true)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .usageClient(usageClient)
                .build();
        runtime.start();
        return runtime;
    }

    private HttpSnapshotProvider provider(TelemetryRuntime runtime) {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl(baseUrl)
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .enableUsageTracking(true)
                .enableMetrics(false)
                .build();
        HttpSnapshotProvider provider = new HttpSnapshotProvider(config);
        provider.setDefinitionCacheRecorder(runtime);
        return provider;
    }

    @Test
    void recordsMissOnNew200AndHitOn304() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        statusCode.set(200);
        etag.set("\"rev-1\"");
        provider.refresh();

        statusCode.set(304);
        provider.refresh();

        runtime.flushUsage();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);

        provider.close();
        runtime.close();
    }

    @Test
    void recordsHitWhenPollSkippedWhileWebSocketLive() throws Exception {
        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        statusCode.set(200);
        provider.refresh();
        runtime.flushUsage();
        sent.clear();

        Field wsField = HttpSnapshotProvider.class.getDeclaredField("wsConnected");
        wsField.setAccessible(true);
        wsField.setBoolean(provider, true);
        Field lastFallback = HttpSnapshotProvider.class.getDeclaredField("lastFallbackRefresh");
        lastFallback.setAccessible(true);
        lastFallback.setLong(provider, System.currentTimeMillis());

        Method refreshSilently = HttpSnapshotProvider.class.getDeclaredMethod("refreshSilently");
        refreshSilently.setAccessible(true);
        refreshSilently.invoke(provider);

        runtime.flushUsage();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isNull();

        provider.close();
        runtime.close();
    }

    @Test
    void doesNotCountConcurrentInFlightRefreshSkips() throws Exception {
        firstRequestStarted = new CountDownLatch(1);
        holdFirstRequest = new CountDownLatch(1);

        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        Thread t = new Thread(provider::refresh);
        t.start();
        assertThat(firstRequestStarted.await(5, TimeUnit.SECONDS)).isTrue();

        // Concurrent refresh while first is in flight — must not count.
        provider.refresh();

        holdFirstRequest.countDown();
        t.join(5000);

        runtime.flushUsage();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isNull();

        provider.close();
        runtime.close();
    }

    @Test
    void recordsHitWhenNetworkFailsAndLastKnownGoodKept() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        statusCode.set(200);
        etag.set("\"rev-1\"");
        provider.refresh();

        statusCode.set(500);
        provider.refresh();

        runtime.flushUsage();
        assertThat(sent.get(0).getDefinitionCacheMisses()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);

        provider.close();
        runtime.close();
    }

    @Test
    void recordsHitForHttp200WithSameRevision() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        statusCode.set(200);
        etag.set("\"rev-1\"");
        provider.refresh();
        provider.refresh(); // same etag again

        runtime.flushUsage();
        assertThat(sent.get(0).getDefinitionCacheMisses()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);

        provider.close();
        runtime.close();
    }

    @Test
    void recordsHitWhenStartupLoadsDurableSnapshotBeforeNetwork() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        TelemetryRuntime runtime = runtime(sent);
        HttpSnapshotProvider provider = provider(runtime);

        FeatureSnapshot cached = new FeatureSnapshot(
                Map.of("cached-feature", FeatureDefinition.builder()
                        .featureKey("cached-feature")
                        .filters(List.of())
                        .build()),
                Map.of(),
                Instant.now(),
                "\"rev-cached\"");

        assertThat(provider.applyCachedSnapshot(cached)).isTrue();

        runtime.flushUsage();
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isNull();

        provider.close();
        runtime.close();
    }
}
