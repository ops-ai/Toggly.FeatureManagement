package io.toggly.core;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SegmentMembershipClientTest {

    private HttpServer server;
    private final AtomicReference<String> method = new AtomicReference<>();
    private final AtomicReference<String> path = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();
    private final AtomicInteger statusCode = new AtomicInteger(200);

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            method.set(exchange.getRequestMethod());
            path.set(exchange.getRequestURI().getRawPath());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            int code = statusCode.get();
            if (code >= 400) {
                exchange.sendResponseHeaders(code, -1);
                exchange.close();
                return;
            }
            byte[] payload = "{\"id\":\"list-1\",\"itemCount\":1}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(code, payload.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(payload);
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private SegmentMembershipClient client() {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        return new SegmentMembershipClient("backend-key", base);
    }

    @Test
    void listSegmentsUsesGet() {
        String response = client().listSegments();
        assertThat(response).contains("list-1");
        assertThat(method.get()).isEqualTo("GET");
        assertThat(path.get()).isEqualTo("/api/v2/segments");
        assertThat(authorization.get()).isEqualTo("backend-key");
    }

    @Test
    void addSegmentMembersPostsIdentifiers() {
        String response = client().addSegmentMembers("Beta Testers", List.of("user-1"));

        assertThat(response).contains("list-1");
        assertThat(method.get()).isEqualTo("POST");
        assertThat(path.get()).isEqualTo("/api/v2/segments/Beta%20Testers/items");
        assertThat(authorization.get()).isEqualTo("backend-key");
        assertThat(body.get()).isEqualTo("{\"identifiers\":[\"user-1\"]}");
    }

    @Test
    void removeSegmentMembersDeletesIdentifiers() {
        String response = client().removeSegmentMembers("Beta Testers", List.of("user-1"));
        assertThat(response).contains("list-1");
        assertThat(method.get()).isEqualTo("DELETE");
        assertThat(path.get()).isEqualTo("/api/v2/segments/Beta%20Testers/items");
        assertThat(body.get()).isEqualTo("{\"identifiers\":[\"user-1\"]}");
    }

    @Test
    void replaceSegmentMembersPutsIdentifiers() {
        String response = client().replaceSegmentMembers("Beta Testers", List.of("user-1"));
        assertThat(response).contains("list-1");
        assertThat(method.get()).isEqualTo("PUT");
        assertThat(path.get()).isEqualTo("/api/v2/segments/Beta%20Testers/items");
        assertThat(body.get()).isEqualTo("{\"identifiers\":[\"user-1\"]}");
    }

    @Test
    void httpErrorThrows() {
        statusCode.set(403);
        assertThatThrownBy(() -> client().listSegments())
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("403");
    }

    @Test
    void rejectsBlankAppKey() {
        assertThatThrownBy(() -> new SegmentMembershipClient(" ", "https://app.toggly.io"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
