package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SmokeTest {

    private static final String APP_KEY_ENV = "TOGGLY_SMOKE_APP_KEY_BACKEND";
    private static final String DEFINITIONS_BASE_URL = "https://definitions.toggly.io";
    private static final String ENVIRONMENT = "Production";

    @Test
    void smokeUnsignedDefinitions() {
        String appKey = System.getenv(APP_KEY_ENV);
        Assumptions.assumeTrue(appKey != null && !appKey.isBlank());

        TogglyConfig config = TogglyConfig.builder()
                .appKey(appKey)
                .environment(ENVIRONMENT)
                .baseUrl(DEFINITIONS_BASE_URL)
                .useSignedDefinitions(false)
                .enableAutoRefresh(false)
                .build();

        try (TogglyClient client = new TogglyClient(config)) {
            assertTrue(client.isEnabled("FlagOn"));
            assertFalse(client.isEnabled("FlagOff"));
        }
    }

    @Test
    void smokeWebSocketConnection() throws Exception {
        String appKey = System.getenv(APP_KEY_ENV);
        Assumptions.assumeTrue(appKey != null && !appKey.isBlank());

        HttpClient client = HttpClient.newHttpClient();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> messageRef = new AtomicReference<>();

        WebSocket ws = client.newWebSocketBuilder()
                .buildAsync(
                        URI.create("wss://definitions.toggly.io/" + appKey + "/ws"),
                        new WebSocket.Listener() {
                            @Override
                            public java.util.concurrent.CompletionStage<?> onText(
                                    WebSocket webSocket, CharSequence data, boolean last) {
                                messageRef.set(data.toString());
                                latch.countDown();
                                return null;
                            }
                        })
                .get(10, TimeUnit.SECONDS);

        assertTrue(latch.await(10, TimeUnit.SECONDS),
                "Did not receive initial message within 10 seconds");

        String msg = messageRef.get();
        assertNotNull(msg);
        assertTrue(msg.contains("\"type\""), "Message should contain type field");
        assertTrue(msg.contains("\"definitions\"") || msg.contains("\"evaluated\""),
                "Message type should be definitions or evaluated");

        ws.sendClose(WebSocket.NORMAL_CLOSURE, "").join();
    }

    @Test
    void smokeSignedDefinitions() {
        String appKey = System.getenv(APP_KEY_ENV);
        Assumptions.assumeTrue(appKey != null && !appKey.isBlank());

        TogglyConfig config = TogglyConfig.builder()
                .appKey(appKey)
                .environment(ENVIRONMENT)
                .baseUrl(DEFINITIONS_BASE_URL)
                .useSignedDefinitions(true)
                .enableAutoRefresh(false)
                .build();

        try (TogglyClient client = new TogglyClient(config)) {
            assertTrue(client.isEnabled("FlagOn"));
            assertFalse(client.isEnabled("FlagOff"));
        }
    }
}
