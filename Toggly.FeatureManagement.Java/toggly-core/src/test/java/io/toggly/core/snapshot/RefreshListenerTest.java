package io.toggly.core.snapshot;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class RefreshListenerTest {

    private HttpServer server;
    private HttpSnapshotProvider provider;
    private final AtomicInteger statusCode = new AtomicInteger(200);
    private final AtomicReference<String> etag = new AtomicReference<>("\"rev-1\"");
    private final AtomicReference<String> body = new AtomicReference<>(
            "[{\"featureKey\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();
        statusCode.set(200);
        etag.set("\"rev-1\"");
        body.set("[{\"featureKey\":\"feature-a\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
    }

    @AfterEach
    void stopServer() {
        if (provider != null) {
            provider.close();
        }
        if (server != null) {
            server.stop(0);
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
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

    private HttpSnapshotProvider newProvider() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .build();
        provider = new HttpSnapshotProvider(config);
        return provider;
    }

    @Test
    void listenerFiresWhenRefreshAppliesChangedSnapshot() {
        HttpSnapshotProvider sdk = newProvider();
        List<FeatureSnapshot> seen = new ArrayList<>();
        sdk.addRefreshListener(seen::add);

        FeatureSnapshot first = sdk.refresh();

        assertThat(seen).containsExactly(first);
        assertThat(first.getFeature("feature-a")).isNotNull();
    }

    @Test
    void listenerDoesNotFireOnUnchangedEtag304() {
        HttpSnapshotProvider sdk = newProvider();
        List<FeatureSnapshot> seen = new ArrayList<>();
        sdk.addRefreshListener(seen::add);

        sdk.refresh();
        seen.clear();

        statusCode.set(304);
        sdk.refresh();

        assertThat(seen).isEmpty();
        assertThat(sdk.getSnapshot().getFeature("feature-a")).isNotNull();
    }

    @Test
    void listenerFiresOnWebSocketForcedRefreshWithChangedSnapshot() throws Exception {
        HttpSnapshotProvider sdk = newProvider();
        sdk.refresh();
        List<FeatureSnapshot> seen = new ArrayList<>();
        sdk.addRefreshListener(seen::add);

        body.set("[{\"featureKey\":\"feature-b\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        etag.set("\"rev-2\"");

        Method notify = HttpSnapshotProvider.class.getDeclaredMethod("handleWebSocketMessage", String.class);
        notify.setAccessible(true);
        notify.invoke(sdk, "{\"event\":\"update\"}");

        assertThat(seen).hasSize(1);
        assertThat(seen.get(0).getFeature("feature-b")).isNotNull();
    }

    @Test
    void listenerFiresOnScheduledPollPathWhenSnapshotChanges() throws Exception {
        HttpSnapshotProvider sdk = newProvider();
        sdk.refresh();
        List<FeatureSnapshot> seen = new ArrayList<>();
        sdk.addRefreshListener(seen::add);

        body.set("[{\"featureKey\":\"polled\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        etag.set("\"rev-poll\"");

        Method refreshSilently = HttpSnapshotProvider.class.getDeclaredMethod("refreshSilently");
        refreshSilently.setAccessible(true);
        refreshSilently.invoke(sdk);

        assertThat(seen).hasSize(1);
        assertThat(seen.get(0).getFeature("polled")).isNotNull();
    }

    @Test
    void throwingListenerDoesNotBreakRefresh() {
        HttpSnapshotProvider sdk = newProvider();
        AtomicInteger goodCalls = new AtomicInteger();
        sdk.addRefreshListener(snapshot -> {
            throw new IllegalStateException("listener boom");
        });
        sdk.addRefreshListener(snapshot -> goodCalls.incrementAndGet());

        assertThatCode(sdk::refresh).doesNotThrowAnyException();
        assertThat(goodCalls).hasValue(1);
        assertThat(sdk.getSnapshot().getFeature("feature-a")).isNotNull();

        statusCode.set(304);
        assertThatCode(sdk::refresh).doesNotThrowAnyException();
        assertThat(goodCalls).hasValue(1);
    }

    @Test
    void removeRefreshListenerStopsNotifications() {
        HttpSnapshotProvider sdk = newProvider();
        List<FeatureSnapshot> seen = new ArrayList<>();
        Consumer<FeatureSnapshot> listener = seen::add;
        sdk.addRefreshListener(listener);
        sdk.refresh();
        assertThat(seen).hasSize(1);

        sdk.removeRefreshListener(listener);
        body.set("[{\"featureKey\":\"after-remove\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        etag.set("\"rev-3\"");
        sdk.refresh();

        assertThat(seen).hasSize(1);
    }

    @Test
    void togglyClientOnRefreshDelegatesToProvider() {
        HttpSnapshotProvider sdk = newProvider();
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app")
                .environment("Production")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        List<FeatureSnapshot> seen = new ArrayList<>();
        try (TogglyClient client = new TogglyClient(config, sdk)) {
            client.onRefresh(seen::add);
            client.refresh();
        }
        assertThat(seen).hasSize(1);
        assertThat(seen.get(0).getFeature("feature-a")).isNotNull();
    }

    @Test
    void inMemoryProviderFiresOnSetSnapshot() {
        InMemorySnapshotProvider memory = new InMemorySnapshotProvider();
        List<FeatureSnapshot> seen = new ArrayList<>();
        Consumer<FeatureSnapshot> listener = seen::add;
        memory.addRefreshListener(listener);

        FeatureSnapshot updated = new FeatureSnapshot(
                Map.of("flag", FeatureDefinition.builder().featureKey("flag").build()),
                Map.of(),
                java.time.Instant.now(),
                "etag-mem");
        memory.setSnapshot(updated);

        assertThat(seen).containsExactly(updated);
        memory.removeRefreshListener(listener);
        memory.setFeatures(Map.of());
        assertThat(seen).hasSize(1);
    }

    @Test
    void applyCachedSnapshotDoesNotNotifyListeners() {
        HttpSnapshotProvider sdk = newProvider();
        List<FeatureSnapshot> seen = new ArrayList<>();
        sdk.addRefreshListener(seen::add);

        FeatureSnapshot cached = new FeatureSnapshot(
                Map.of("cached", FeatureDefinition.builder().featureKey("cached").build()),
                Map.of(),
                java.time.Instant.now(),
                "\"cached-etag\"");
        assertThat(sdk.applyCachedSnapshot(cached)).isTrue();
        assertThat(sdk.getSnapshot().getFeature("cached")).isNotNull();
        assertThat(seen).isEmpty();

        // Network refresh still notifies.
        sdk.refresh();
        assertThat(seen).hasSize(1);
        assertThat(seen.get(0).getFeature("feature-a")).isNotNull();
    }

    @Test
    void applyCachedSnapshotReentryFromListenerDoesNotRecurse() {
        HttpSnapshotProvider sdk = newProvider();
        AtomicInteger calls = new AtomicInteger();
        sdk.addRefreshListener(snapshot -> {
            calls.incrementAndGet();
            // Simulate Redis durable re-apply that a listener may trigger via getSnapshot.
            FeatureSnapshot cached = new FeatureSnapshot(
                    Map.of("reenter", FeatureDefinition.builder().featureKey("reenter").build()),
                    Map.of(),
                    java.time.Instant.now(),
                    "\"reenter\"");
            assertThat(sdk.applyCachedSnapshot(cached)).isTrue();
        });

        assertThatCode(sdk::refresh).doesNotThrowAnyException();
        assertThat(calls).hasValue(1);
        assertThat(sdk.getSnapshot().getFeature("reenter")).isNotNull();
    }
}
