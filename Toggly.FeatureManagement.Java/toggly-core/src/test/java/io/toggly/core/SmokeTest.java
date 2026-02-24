package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.HttpSnapshotProvider;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.concurrent.TimeUnit;

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

        TogglyConfig config = TogglyConfig.builder()
                .appKey(appKey)
                .environment(ENVIRONMENT)
                .baseUrl(DEFINITIONS_BASE_URL)
                .enableLiveUpdates(true)
                .enableAutoRefresh(false)
                .useSignedDefinitions(false)
                .build();

        try (TogglyClient client = new TogglyClient(config)) {
            // Trigger initial fetch which starts the WebSocket connection
            assertTrue(client.isEnabled("FlagOn"), "FlagOn should be enabled");
            assertFalse(client.isEnabled("FlagOff"), "FlagOff should be disabled");

            // Wait for the SDK's built-in WebSocket to connect
            Field providerField = TogglyClient.class.getDeclaredField("snapshotProvider");
            providerField.setAccessible(true);
            Object provider = providerField.get(client);
            assertNotNull(provider, "Snapshot provider should not be null");
            assertTrue(provider instanceof HttpSnapshotProvider, "Provider should be HttpSnapshotProvider");

            Field wsField = HttpSnapshotProvider.class.getDeclaredField("wsConnected");
            wsField.setAccessible(true);

            boolean connected = false;
            for (int i = 0; i < 30; i++) {
                if (wsField.getBoolean(provider)) {
                    connected = true;
                    break;
                }
                TimeUnit.MILLISECONDS.sleep(500);
            }
            assertTrue(connected, "SDK WebSocket should be connected within 15 seconds");

            // Verify flags still work after WebSocket is connected
            assertTrue(client.isEnabled("FlagOn"));
            assertFalse(client.isEnabled("FlagOff"));
        }
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
