package io.toggly.core.snapshot;

import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HttpSnapshotProviderParsingTest {
    private HttpServer server;
    private HttpSnapshotProvider provider;
    private final AtomicReference<String> body = new AtomicReference<>("[]");
    private final AtomicReference<String> etag = new AtomicReference<>("\"rev-1\"");
    private final AtomicInteger status = new AtomicInteger(200);
    private final AtomicReference<String> requestedPath = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestedPath.set(exchange.getRequestURI().getPath());
            exchange.getResponseHeaders().set("ETag", etag.get());
            byte[] response = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        if (provider != null) provider.close();
        if (server != null) server.stop(0);
    }

    private HttpSnapshotProvider provider(boolean signed, AtomicReference<String> error) {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("app")
                .environment("Staging")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/")
                .refreshIntervalSeconds(0)
                .enableLiveUpdates(false)
                .useSignedDefinitions(signed)
                .onError((message, cause) -> error.set(message))
                .build();
        provider = new HttpSnapshotProvider(config);
        return provider;
    }

    @Test
    void parsesLegacyCatalogFieldsMetricsAndVariantAllocation() {
        body.set("""
                {"feature_flags":[{"feature_key":"checkout","requirement_type":"All",
                   "filters":[{"name":"Percentage","parameters":{"Value":25.5,"Enabled":true,"Missing":null}}],
                   "variants":[{"name":"A","configurationValue":{"color":"blue"}}],
                   "allocation":{"defaultWhenEnabled":"A"}},
                   {"filters":[]}, {"featureKey":"new-key","requirementType":"Any","contextKind":"Account",
                    "contextRequirementType":"All","filters":[{"name":"AlwaysOn"}]}],
                 "metrics":[{"metric_key":"orders","name":"Purchases","unit":"count"}]}
                """);
        HttpSnapshotProvider sdk = provider(false, new AtomicReference<>());

        FeatureSnapshot snapshot = sdk.getSnapshotAsync().join();

        assertThat(requestedPath.get()).isEqualTo("/definitions/app/Staging");
        assertThat(snapshot.getFeatures()).containsOnlyKeys("checkout", "new-key");
        FeatureDefinition checkout = snapshot.getFeature("checkout");
        assertThat(checkout.getFilters().get(0).getDoubleParameter("Value", 0)).isEqualTo(25.5);
        assertThat(checkout.getFilters().get(0).getParameters()).containsEntry("Enabled", true)
                .containsKey("Missing");
        assertThat(checkout.getVariants()).hasSize(1);
        assertThat(checkout.getAllocation().getDefaultWhenEnabled()).isEqualTo("A");
        assertThat(snapshot.getFeature("new-key").getContextKind()).isEqualTo("Account");
        assertThat(snapshot.getMetrics()).containsKey("orders");
        assertThat(snapshot.getMetrics().get("orders").getName()).isEqualTo("Purchases");
        assertThat(sdk.getSnapshot()).isSameAs(snapshot);
        assertThat(sdk.getSnapshotAsync().join()).isSameAs(snapshot);
    }

    @Test
    void clearRemovesSnapshotEtagAndCachedJwks() {
        body.set("[{\"featureKey\":\"flag\",\"filters\":[{\"name\":\"AlwaysOn\"}]}]");
        HttpSnapshotProvider sdk = provider(false, new AtomicReference<>());
        assertThat(sdk.refreshAsync().join().getFeature("flag")).isNotNull();
        assertThat(sdk.getSnapshot().getEtag()).isEqualTo("\"rev-1\"");
        sdk.saveJwks(io.toggly.core.crypto.JsonWebKeySet.empty(), Instant.now().plusSeconds(30));
        assertThat(sdk.loadJwks()).isNotNull();

        sdk.clear();
        assertThat(sdk.loadJwks()).isNull();
        assertThat(sdk.applyCachedSnapshot(null)).isFalse();
        assertThat(sdk.applyCachedSnapshot(FeatureSnapshot.empty())).isFalse();
        etag.set("\"rev-2\"");
        assertThat(sdk.getSnapshot().getFeature("flag")).isNotNull();
    }

    @Test
    void refreshFailurePreservesLastKnownGoodAndInvokesCallback() {
        body.set("[{\"featureKey\":\"stable\"}]");
        AtomicReference<String> error = new AtomicReference<>();
        HttpSnapshotProvider sdk = provider(false, error);
        FeatureSnapshot stable = sdk.refresh();
        status.set(503);

        assertThat(sdk.refresh()).isSameAs(stable);
        assertThat(error.get()).isEqualTo("Failed to refresh definitions");
        assertThat(sdk.getSnapshot().getFeatures()).containsKey("stable");
    }

    @Test
    void signedResponseWithoutRequiredFieldsIsNotApplied() {
        body.set("{\"defs\":[]}");
        AtomicReference<String> error = new AtomicReference<>();
        HttpSnapshotProvider sdk = provider(true, error);

        assertThat(sdk.refresh().isEmpty()).isTrue();
        assertThat(requestedPath.get()).isEqualTo("/definitions-signed/app/Staging");
        assertThat(error.get()).isEqualTo("Invalid signature");

        FeatureSnapshot legacy = new FeatureSnapshot(
                Map.of("cached", FeatureDefinition.builder().featureKey("cached").build()),
                Map.of(), Instant.now(), "cached");
        assertThat(sdk.applyCachedSnapshot(legacy)).isTrue();
        assertThat(sdk.getSnapshot().getFeature("cached")).isNotNull();
    }

    @Test
    void signedEnvelopeRejectsEachMissingRequiredField() {
        AtomicReference<String> error = new AtomicReference<>();
        HttpSnapshotProvider sdk = provider(true, error);
        String[] malformed = {
                "{\"signature\":\"sig\",\"kid\":\"kid\",\"timestamp\":1}",
                "{\"defs\":[],\"kid\":\"kid\",\"timestamp\":1}",
                "{\"defs\":[],\"signature\":\"sig\",\"timestamp\":1}",
                "{\"defs\":[],\"signature\":\"sig\",\"kid\":\"kid\"}"
        };
        for (int i = 0; i < malformed.length; i++) {
            body.set(malformed[i]);
            etag.set("\"invalid-" + i + "\"");
            assertThat(sdk.refresh().isEmpty()).isTrue();
            assertThat(error.get()).isEqualTo("Invalid signature");
        }
    }

    @Test
    void websocketNotificationsDistinguishPingAndSigningKeyChanges() throws Exception {
        body.set("[{\"featureKey\":\"original\"}]");
        HttpSnapshotProvider sdk = provider(false, new AtomicReference<>());
        sdk.refresh();
        sdk.saveJwks(io.toggly.core.crypto.JsonWebKeySet.empty(), Instant.now().plusSeconds(30));
        Method notify = HttpSnapshotProvider.class.getDeclaredMethod("handleWebSocketMessage", String.class);
        notify.setAccessible(true);
        notify.invoke(sdk, "{\"type\":\"ping\"}");
        assertThat(sdk.loadJwks()).isNotNull();

        body.set("[{\"featureKey\":\"updated\"}]");
        etag.set("\"rev-2\"");
        notify.invoke(sdk, "{\"event\":\"signing-key-updated\"}");
        assertThat(sdk.loadJwks()).isNull();
        assertThat(sdk.getSnapshot().getFeature("updated")).isNotNull();

        body.set("[{\"featureKey\":\"last\"}]");
        etag.set("\"rev-3\"");
        notify.invoke(sdk, "{\"event\":\"update\"}");
        assertThat(sdk.getSnapshot().getFeature("last")).isNotNull();
    }
}
