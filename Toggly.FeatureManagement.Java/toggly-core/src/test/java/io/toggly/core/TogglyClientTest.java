package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class TogglyClientTest {

    private TogglyClient client;
    private InMemorySnapshotProvider snapshotProvider;

    @BeforeEach
    void setUp() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .defaultFeatureState(false)
                .featureDefault("default-enabled", true)
                .build();

        snapshotProvider = new InMemorySnapshotProvider();
        client = new TogglyClient(config, snapshotProvider);
    }

    @Test
    void shouldReturnFalseForUnknownFeature() {
        assertFalse(client.isEnabled("unknown-feature"));
    }

    @Test
    void shouldReturnDefaultForUnknownFeature() {
        assertTrue(client.isEnabled("default-enabled"));
    }

    @Test
    void shouldEvaluateFeatureWithAlwaysOnFilter() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("always-on-feature", createAlwaysOnFeature("always-on-feature"));
        snapshotProvider.setFeatures(features);

        assertTrue(client.isEnabled("always-on-feature"));
    }

    @Test
    void shouldEvaluateFeatureWithContext() {
        Map<String, Object> params = new HashMap<>();
        params.put("users", "special-user");

        FeatureFilter filter = FeatureFilter.of("Targeting", params);

        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("targeted-feature")
                .filters(List.of(filter))
                .build();

        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("targeted-feature", definition);
        snapshotProvider.setFeatures(features);

        EvaluationContext context = EvaluationContext.builder()
                .identity("special-user")
                .build();

        assertTrue(client.isEnabled("targeted-feature", context));
        assertFalse(client.isEnabled("targeted-feature",
                EvaluationContext.builder().identity("other-user").build()));
    }

    @Test
    void shouldReturnAllEnabledWithAllEnabled() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        features.put("feature-b", createAlwaysOnFeature("feature-b"));
        snapshotProvider.setFeatures(features);

        assertTrue(client.allEnabled(List.of("feature-a", "feature-b")));
    }

    @Test
    void shouldReturnFalseForAllEnabledWithDisabledFeature() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        features.put("feature-b", FeatureDefinition.builder()
                .featureKey("feature-b")
                .build()); // No filters = disabled
        snapshotProvider.setFeatures(features);

        assertFalse(client.allEnabled(List.of("feature-a", "feature-b")));
    }

    @Test
    void shouldReturnAnyEnabledWithOneEnabled() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        features.put("feature-b", FeatureDefinition.builder()
                .featureKey("feature-b")
                .build()); // No filters = disabled
        snapshotProvider.setFeatures(features);

        assertTrue(client.anyEnabled(List.of("feature-a", "feature-b")));
    }

    @Test
    void shouldReturnNoneEnabledWhenAllDisabled() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", FeatureDefinition.builder()
                .featureKey("feature-a")
                .build());
        features.put("feature-b", FeatureDefinition.builder()
                .featureKey("feature-b")
                .build());
        snapshotProvider.setFeatures(features);

        assertTrue(client.noneEnabled(List.of("feature-a", "feature-b")));
    }

    @Test
    void shouldExecuteIfEnabled() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        snapshotProvider.setFeatures(features);

        boolean[] executed = {false};
        boolean result = client.ifEnabled("feature-a", () -> executed[0] = true);

        assertTrue(result);
        assertTrue(executed[0]);
    }

    @Test
    void shouldNotExecuteIfDisabled() {
        boolean[] executed = {false};
        boolean result = client.ifEnabled("disabled-feature", () -> executed[0] = true);

        assertFalse(result);
        assertFalse(executed[0]);
    }

    @Test
    void shouldGetValueBasedOnFeatureState() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        snapshotProvider.setFeatures(features);

        assertEquals("enabled", client.getValue("feature-a", "enabled", "disabled"));
        assertEquals("disabled", client.getValue("unknown", "enabled", "disabled"));
    }

    @Test
    void shouldEvaluateAllFeatures() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        features.put("feature-b", FeatureDefinition.builder()
                .featureKey("feature-b")
                .build());
        snapshotProvider.setFeatures(features);

        Map<String, Boolean> results = client.evaluateAll();

        assertTrue(results.get("feature-a"));
        assertFalse(results.get("feature-b"));
    }

    @Test
    void shouldGetFeatureKeys() {
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        features.put("feature-b", createAlwaysOnFeature("feature-b"));
        snapshotProvider.setFeatures(features);

        assertEquals(2, client.getFeatureKeys().size());
        assertTrue(client.getFeatureKeys().contains("feature-a"));
        assertTrue(client.getFeatureKeys().contains("feature-b"));
    }

    @Test
    void shouldGetFeatureDefinition() {
        FeatureDefinition definition = createAlwaysOnFeature("feature-a");
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", definition);
        snapshotProvider.setFeatures(features);

        assertNotNull(client.getFeatureDefinition("feature-a"));
        assertNull(client.getFeatureDefinition("unknown"));
    }

    private FeatureDefinition createAlwaysOnFeature(String key) {
        FeatureFilter filter = FeatureFilter.alwaysOn();

        return FeatureDefinition.builder()
                .featureKey(key)
                .filters(List.of(filter))
                .build();
    }
}
