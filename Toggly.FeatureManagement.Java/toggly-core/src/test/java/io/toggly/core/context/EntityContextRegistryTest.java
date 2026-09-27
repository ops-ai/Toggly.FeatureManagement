package io.toggly.core.context;

import com.sun.net.httpserver.HttpServer;
import io.toggly.core.config.TogglyConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EntityContextRegistryTest {
    private HttpServer server;

    @AfterEach
    void tearDown() {
        EntityContextRegistry.clear();
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void mapsRegisteredKindsAndSnapshotsSchemaList() {
        EntityContextRegistry.EntityContextSchemaRegistration schema =
                new EntityContextRegistry.EntityContextSchemaRegistration(
                        null, "id", null,
                        List.of(new EntityContextRegistry.EntityContextPropertySchema("region", "string")));
        TogglyEntityContext context = new TogglyEntityContext("account", "a-1", java.util.Map.of());
        EntityContextRegistry.registerContext("account", ignored -> context, schema);

        assertThat(EntityContextRegistry.map("account", new Object())).isSameAs(context);
        assertThat(EntityContextRegistry.map("unknown", new Object())).isNull();
        assertThat(EntityContextRegistry.getSchemaRegistrations()).singleElement()
                .satisfies(registered -> {
                    assertThat(registered.kind()).isEqualTo("account");
                    assertThat(registered.displayName()).isEqualTo("account");
                    assertThat(registered.properties()).hasSize(1);
                });
        assertThatThrownBy(() -> EntityContextRegistry.registerContext(null, ignored -> context))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> EntityContextRegistry.registerContext("account", null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void startupRegistrationSendsEscapedSchemaToConfiguredEndpoint() throws IOException {
        AtomicReference<String> request = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            path.set(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            request.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        EntityContextRegistry.registerContext("account", entity -> null,
                new EntityContextRegistry.EntityContextSchemaRegistration(
                        null, "id", "Accounts \"West\"",
                        List.of(new EntityContextRegistry.EntityContextPropertySchema("path\\name", "string"))));

        TogglyConfig config = TogglyConfig.builder()
                .appKey("app")
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort())
                .registerContextsOnStartup(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        EntityContextRegistry.registerAtStartup(config);

        assertThat(path.get()).isEqualTo("PUT /sdk/app/contexts");
        assertThat(request.get()).contains("\"kind\":\"account\"")
                .contains("\"displayName\":\"Accounts \\\"West\\\"\"")
                .contains("\"name\":\"path\\\\name\"");
    }

    @Test
    void startupRegistrationSkipsAbsentConfigurationOrSchemas() {
        EntityContextRegistry.registerAtStartup(null);
        TogglyConfig disabled = TogglyConfig.builder().appKey("app")
                .registerContextsOnStartup(false).build();
        EntityContextRegistry.registerAtStartup(disabled);
        TogglyConfig enabled = TogglyConfig.builder().appKey("app")
                .registerContextsOnStartup(true).build();
        EntityContextRegistry.registerAtStartup(enabled);
        assertThat(EntityContextRegistry.getSchemaRegistrations()).isEmpty();
    }
}
