package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
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
