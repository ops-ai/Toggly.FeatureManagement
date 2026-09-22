package io.toggly.cache.redis;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.EvaluatedVariantDef;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import io.toggly.core.snapshot.VariantSnapshot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import redis.clients.jedis.JedisPool;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression coverage: the Redis caching wrapper must forward
 * getVariant/getVariantValue support (getVariantSnapshot / getVariantSnapshotAsync /
 * refreshVariants) to its delegate. Without an explicit override,
 * {@code RedisCachingSnapshotProvider} would silently inherit
 * {@link io.toggly.core.snapshot.SnapshotProvider}'s default no-ops and always
 * report an empty variant snapshot, breaking {@code getVariant}/{@code
 * getVariantValue} for any app that wraps its provider with Redis caching.
 *
 * <p>Variants are not distributed through Redis (the delegate keeps its own
 * last-known-good variant snapshot), so the mocked {@link JedisPool} is never
 * exercised by these assertions.</p>
 */
@ExtendWith(MockitoExtension.class)
class RedisCachingSnapshotProviderVariantsTest {

    @Mock
    private JedisPool pool;

    private HttpServer server;
    private String baseUrl;
    private HttpSnapshotProvider delegate;
    private RedisCachingSnapshotProvider redis;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        if (delegate != null) {
            delegate.close();
        }
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        byte[] bytes;
        if (path.startsWith("/evaluated-variants-signed/")) {
            bytes = ("{\"defs\":{\"feature-a\":{\"enabled\":true,\"variant\":\"B\","
                    + "\"configurationValue\":\"config-x\"}}}").getBytes(StandardCharsets.UTF_8);
        } else {
            bytes = ("[{\"feature_key\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\","
                    + "\"parameters\":{}}]}]").getBytes(StandardCharsets.UTF_8);
        }
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private TogglyConfig buildConfig() {
        return TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl(baseUrl)
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .enableVariants(true)
                .build();
    }

    private RedisCachingSnapshotProvider buildRedis() {
        delegate = new HttpSnapshotProvider(buildConfig());
        return new RedisCachingSnapshotProvider(delegate, pool, "toggly:variants-test:", Duration.ofMinutes(5));
    }

    @Test
    void forwardsGetVariantSnapshotToDelegate() {
        redis = buildRedis();

        VariantSnapshot snapshot = redis.getVariantSnapshot();

        EvaluatedVariantDef entry = snapshot.getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.isEnabled()).isTrue();
        assertThat(entry.getVariant()).isEqualTo("B");
        assertThat(entry.getConfigurationValue()).isEqualTo("config-x");
    }

    @Test
    void forwardsGetVariantSnapshotAsyncToDelegate() throws Exception {
        redis = buildRedis();

        VariantSnapshot snapshot = redis.getVariantSnapshotAsync().get();

        EvaluatedVariantDef entry = snapshot.getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.getVariant()).isEqualTo("B");
    }

    @Test
    void forwardsRefreshVariantsToDelegate() {
        redis = buildRedis();

        VariantSnapshot snapshot = redis.refreshVariants();

        EvaluatedVariantDef entry = snapshot.getVariant("feature-a");
        assertThat(entry).isNotNull();
        assertThat(entry.getVariant()).isEqualTo("B");
    }

    @Test
    void doesNotSilentlyFallBackToEmptyDefaultWhenVariantsEnabled() {
        redis = buildRedis();

        assertThat(redis.getVariantSnapshot().isEmpty()).isFalse();
    }
}
