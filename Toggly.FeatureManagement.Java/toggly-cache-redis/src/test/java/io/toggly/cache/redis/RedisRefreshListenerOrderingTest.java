package io.toggly.cache.redis;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * Proves Redis is updated before onRefresh listeners run, and durable cache hits do not
 * re-enter listener notification (Seer HIGH / Codex P2 on PR #854).
 */
@ExtendWith(MockitoExtension.class)
class RedisRefreshListenerOrderingTest {

    @Mock
    private JedisPool pool;

    @Mock
    private Jedis jedis;

    private HttpServer server;
    private final AtomicInteger statusCode = new AtomicInteger(200);
    private final AtomicBoolean notModifiedWhenEtagMatches = new AtomicBoolean();
    private final AtomicReference<String> lastIfNoneMatch = new AtomicReference<>();
    private final AtomicReference<String> etag = new AtomicReference<>("\"rev-1\"");
    private final AtomicReference<String> body = new AtomicReference<>(
            "[{\"featureKey\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
    private HttpSnapshotProvider http;
    private RedisCachingSnapshotProvider redis;
    private final AtomicReference<String> redisStore = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        statusCode.set(200);
        notModifiedWhenEtagMatches.set(false);
        lastIfNoneMatch.set(null);
        etag.set("\"rev-1\"");
        body.set("[{\"featureKey\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        redisStore.set(null);

        when(pool.getResource()).thenReturn(jedis);
        when(jedis.get(anyString())).thenAnswer(invocation -> redisStore.get());
        doAnswer(invocation -> {
            redisStore.set(invocation.getArgument(2));
            return null;
        }).when(jedis).setex(anyString(), anyLong(), anyString());
    }

    @AfterEach
    void tearDown() {
        if (redis != null) {
            redis.close();
        } else if (http != null) {
            http.close();
        }
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        String ifNoneMatch = exchange.getRequestHeaders().getFirst("If-None-Match");
        lastIfNoneMatch.set(ifNoneMatch);
        int code = statusCode.get();
        String tag = etag.get();
        if (notModifiedWhenEtagMatches.get() && tag != null && tag.equals(ifNoneMatch)) {
            code = 304;
        }
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

    private RedisCachingSnapshotProvider newRedis() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .build();
        http = new HttpSnapshotProvider(config);
        redis = new RedisCachingSnapshotProvider(http, pool, "toggly:order:", Duration.ofMinutes(5));
        return redis;
    }

    @Test
    void refreshListenerSeesUpdatedRedisSnapshotBeforeCallbackReturns() {
        RedisCachingSnapshotProvider provider = newRedis();
        provider.refresh();
        assertThat(redisStore.get()).contains("feature-a");

        body.set("[{\"featureKey\":\"feature-b\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        etag.set("\"rev-2\"");

        List<String> featuresSeenFromCache = new ArrayList<>();
        provider.addRefreshListener(snapshot -> {
            FeatureSnapshot fromRedis = provider.getSnapshot();
            featuresSeenFromCache.add(
                    fromRedis.getFeature("feature-b") != null ? "feature-b"
                            : fromRedis.getFeature("feature-a") != null ? "feature-a"
                            : "none");
            assertThat(snapshot.getFeature("feature-b")).isNotNull();
        });

        provider.refresh();

        assertThat(featuresSeenFromCache).containsExactly("feature-b");
        assertThat(redisStore.get()).contains("feature-b");
    }

    @Test
    void durableCacheHitDoesNotNotifyAndListenerGetSnapshotDoesNotRecurse() {
        RedisCachingSnapshotProvider provider = newRedis();
        provider.refresh();
        String durable = redisStore.get();
        assertThat(durable).isNotNull();

        http.clear();
        AtomicInteger durableHitCalls = new AtomicInteger();
        Consumer<FeatureSnapshot> durableProbe = snapshot -> durableHitCalls.incrementAndGet();
        provider.addRefreshListener(durableProbe);

        // Simulate process restart: in-memory empty, Redis still has durable JSON.
        FeatureSnapshot loaded = provider.getSnapshot();
        assertThat(loaded.getFeature("feature-a")).isNotNull();
        assertThat(durableHitCalls).hasValue(0);
        provider.removeRefreshListener(durableProbe);

        // Listener that re-reads from Redis during a real refresh must not stack-overflow
        // when durable applyCachedSnapshot runs inside getSnapshot.
        AtomicInteger refreshCalls = new AtomicInteger();
        provider.addRefreshListener(snapshot -> {
            refreshCalls.incrementAndGet();
            assertThatCode(provider::getSnapshot).doesNotThrowAnyException();
            assertThat(provider.getSnapshot().getFeature("feature-c")).isNotNull();
        });

        body.set("[{\"featureKey\":\"feature-c\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        etag.set("\"rev-3\"");
        provider.refresh();

        assertThat(refreshCalls).hasValue(1);
        assertThat(provider.getSnapshot().getFeature("feature-c")).isNotNull();
    }

    @Test
    void unchanged304RefreshDoesNotNotifyListeners() {
        RedisCachingSnapshotProvider provider = newRedis();
        provider.refresh();
        AtomicInteger listenerCalls = new AtomicInteger();
        provider.addRefreshListener(snapshot -> listenerCalls.incrementAndGet());

        statusCode.set(304);
        provider.refresh();

        assertThat(listenerCalls).hasValue(0);
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();
    }

    @Test
    void peerRedisRevisionNotifiesOnceAndLaterReadsDoNot() {
        RedisCachingSnapshotProvider writer = newRedis();
        TogglyConfig readerConfig = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .build();
        HttpSnapshotProvider readerHttp = new HttpSnapshotProvider(readerConfig);
        RedisCachingSnapshotProvider reader = new RedisCachingSnapshotProvider(
                readerHttp, pool, "toggly:order:", Duration.ofMinutes(5));
        try {
            writer.refresh();

            AtomicInteger calls = new AtomicInteger();
            reader.addRefreshListener(snapshot -> {
                calls.incrementAndGet();
                assertThatCode(reader::getSnapshot).doesNotThrowAnyException();
                assertThat(snapshot.getFeature("feature-b")).isNotNull();
                assertThat(reader.getSnapshot().getFeature("feature-b")).isNotNull();
            });

            FeatureSnapshot initial = reader.getSnapshot();
            assertThat(initial.getFeature("feature-a")).isNotNull();
            assertThat(calls).hasValue(0);

            body.set("[{\"featureKey\":\"feature-b\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
            etag.set("\"rev-2\"");
            writer.refresh();

            FeatureSnapshot adopted = reader.getSnapshot();
            assertThat(adopted.getFeature("feature-b")).isNotNull();
            assertThat(calls).hasValue(1);

            reader.getSnapshot();
            assertThat(calls).hasValue(1);

            statusCode.set(304);
            reader.refresh();
            assertThat(calls).hasValue(1);
            assertThat(reader.getSnapshot().getFeature("feature-b")).isNotNull();
        } finally {
            reader.close();
        }
    }

    @Test
    void quotedEtagRoundTripKeeps304AndDoesNotNotify() {
        RedisCachingSnapshotProvider provider = newRedis();
        provider.refresh();

        http.clear();
        FeatureSnapshot loaded = provider.getSnapshot();
        assertThat(loaded.getEtag()).isEqualTo("\"rev-1\"");

        AtomicInteger calls = new AtomicInteger();
        provider.addRefreshListener(snapshot -> calls.incrementAndGet());
        notModifiedWhenEtagMatches.set(true);
        provider.refresh();

        assertThat(lastIfNoneMatch.get()).isEqualTo("\"rev-1\"");
        assertThat(calls).hasValue(0);
        assertThat(provider.getSnapshot().getFeature("feature-a")).isNotNull();
    }

    @Test
    void filterParameterBackslashSurvivesRedisWithoutRenotify() {
        body.set("[{\"featureKey\":\"feature-a\",\"filters\":[{\"name\":\"Targeting\","
                + "\"parameters\":{\"path\":\"C:\\\\temp\",\"note\":null}}]}]");
        RedisCachingSnapshotProvider provider = newRedis();
        provider.refresh();
        Object original = provider.getSnapshot()
                .getFeature("feature-a").getFilters().get(0).getParameters().get("path");

        http.clear();
        AtomicInteger calls = new AtomicInteger();
        provider.addRefreshListener(snapshot -> calls.incrementAndGet());
        FeatureSnapshot loaded = provider.getSnapshot();

        assertThat(loaded.getFeature("feature-a").getFilters().get(0).getParameters())
                .containsEntry("path", original)
                .containsEntry("note", null);
        assertThat(calls).hasValue(0);
        provider.getSnapshot();
        assertThat(calls).hasValue(0);
    }

    @Test
    void peerReadDoesNotBorrowTwoRedisConnections() {
        AtomicInteger inflight = new AtomicInteger();
        AtomicInteger maxInflight = new AtomicInteger();
        when(pool.getResource()).thenAnswer(invocation -> {
            int now = inflight.incrementAndGet();
            maxInflight.accumulateAndGet(now, Math::max);
            return jedis;
        });
        doAnswer(invocation -> {
            inflight.decrementAndGet();
            return null;
        }).when(jedis).close();

        RedisCachingSnapshotProvider writer = newRedis();
        TogglyConfig readerConfig = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .build();
        HttpSnapshotProvider readerHttp = new HttpSnapshotProvider(readerConfig);
        RedisCachingSnapshotProvider reader = new RedisCachingSnapshotProvider(
                readerHttp, pool, "toggly:order:", Duration.ofMinutes(5));
        try {
            writer.refresh();
            reader.getSnapshot();
            body.set("[{\"featureKey\":\"feature-b\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
            etag.set("\"rev-2\"");
            writer.refresh();
            reader.addRefreshListener(snapshot -> assertThat(snapshot.getFeature("feature-b")).isNotNull());
            assertThat(reader.getSnapshot().getFeature("feature-b")).isNotNull();
            assertThat(maxInflight).hasValue(1);
        } finally {
            reader.close();
        }
    }
}
