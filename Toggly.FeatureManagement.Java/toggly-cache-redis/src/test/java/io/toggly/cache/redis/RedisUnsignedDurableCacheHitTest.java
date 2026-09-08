package io.toggly.cache.redis;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import io.toggly.core.telemetry.FeatureStatPayload;
import io.toggly.core.telemetry.TelemetryRuntime;
import io.toggly.core.telemetry.UsageGrpcClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Wrapper-level coverage: unsigned Redis durable load must record a definition-cache hit
 * via {@code getSnapshot()}, not only when callers invoke {@code applyCachedSnapshot} directly.
 */
@ExtendWith(MockitoExtension.class)
class RedisUnsignedDurableCacheHitTest {

    @Mock
    private JedisPool pool;

    @Mock
    private Jedis jedis;

    private HttpServer server;
    private String baseUrl;
    private HttpSnapshotProvider http;
    private RedisCachingSnapshotProvider redis;
    private TelemetryRuntime runtime;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        if (http != null) {
            http.close();
        }
        if (runtime != null) {
            runtime.close();
        }
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        byte[] bytes = ("[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\","
                + "\"parameters\":{}}]}]")
                .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("ETag", "\"rev-1\"");
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    @Test
    void unsignedDurableRedisLoadRecordsExactlyOneHitViaGetSnapshot() {
        List<FeatureStatPayload> sent = new ArrayList<>();
        runtime = TelemetryRuntime.builder()
                .appKey("test-app")
                .environment("Production")
                .enableUsageTracking(true)
                .enableMetrics(false)
                .usageFlushInterval(Duration.ZERO)
                .usageClient(new UsageGrpcClient() {
                    @Override
                    public void sendStats(FeatureStatPayload payload) {
                        sent.add(payload);
                    }

                    @Override
                    public void close() {
                    }
                })
                .build();
        runtime.start();

        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl(baseUrl)
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .useSignedDefinitions(false)
                .enableUsageTracking(true)
                .enableMetrics(false)
                .build();

        http = new HttpSnapshotProvider(config);
        redis = new RedisCachingSnapshotProvider(http, pool, "toggly:test:", Duration.ofMinutes(5));
        redis.setDefinitionCacheRecorder(runtime);

        when(pool.getResource()).thenReturn(jedis);
        // Seed: refresh fetches HTTP (miss) and writes unsigned JSON into Redis.
        when(jedis.get(anyString())).thenReturn(null);
        redis.refresh();

        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> valueCaptor = ArgumentCaptor.forClass(String.class);
        verify(jedis, atLeastOnce()).setex(keyCaptor.capture(), anyLong(), valueCaptor.capture());
        String durableJson = valueCaptor.getValue();
        assertThat(durableJson).contains("feature-a");
        assertThat(durableJson).doesNotContain("signature");

        // Drop in-memory defs so the next getSnapshot is a true durable-cache startup.
        http.clear();
        runtime.flushUsage();
        sent.clear();

        // Wrapper getSnapshot path serving unsigned Redis JSON — not a direct applyCachedSnapshot call.
        when(jedis.get(anyString())).thenReturn(durableJson);
        assertThat(redis.getSnapshot().getFeature("feature-a")).isNotNull();

        runtime.flushUsage();
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).getDefinitionCacheHits()).isEqualTo(1);
        assertThat(sent.get(0).getDefinitionCacheMisses()).isNull();

        // Subsequent durable reads must not double-count.
        sent.clear();
        assertThat(redis.getSnapshot().getFeature("feature-a")).isNotNull();
        runtime.flushUsage();
        assertThat(sent).isEmpty();
    }
}
