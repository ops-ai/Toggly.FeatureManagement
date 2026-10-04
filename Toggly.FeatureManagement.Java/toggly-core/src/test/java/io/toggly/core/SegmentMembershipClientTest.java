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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SegmentMembershipClientTest {

    private HttpServer server;
    private final AtomicReference<String> method = new AtomicReference<>();
    private final AtomicReference<String> path = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v2/segments", exchange -> {
            method.set(exchange.getRequestMethod());
            path.set(exchange.getRequestURI().getRawPath());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] payload = "{\"id\":\"list-1\",\"itemCount\":1}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, payload.length);
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

    @Test
    void addSegmentMembersPostsIdentifiers() {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        SegmentMembershipClient client = new SegmentMembershipClient("backend-key", base);

        String response = client.addSegmentMembers("Beta Testers", List.of("user-1"));

        assertThat(response).contains("list-1");
        assertThat(method.get()).isEqualTo("POST");
        assertThat(path.get()).isEqualTo("/api/v2/segments/Beta%20Testers/items");
        assertThat(authorization.get()).isEqualTo("backend-key");
        assertThat(body.get()).isEqualTo("{\"identifiers\":[\"user-1\"]}");
    }

    @Test
    void rejectsBlankAppKey() {
        assertThatThrownBy(() -> new SegmentMembershipClient(" ", "https://app.toggly.io"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
