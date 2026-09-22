package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.EvaluatedVariantDef;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.VariantResult;
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
                .enableUsageTracking(false)
                .enableMetrics(false)
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

    // ========== Feature Variants (dual-rail) ==========

    @Test
    void shouldReturnNullVariantWhenEnableVariantsIsFalse() {
        // Client under test has enableVariants=false (default) from setUp().
        snapshotProvider.setVariants(Map.of(
                "feature-a", new EvaluatedVariantDef(true, "B", "config-value")));

        assertNull(client.getVariant("feature-a"));
        assertNull(client.getVariantValue("feature-a"));
    }

    @Test
    void shouldReturnAssignedVariantWhenEnabled() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        provider.setVariants(Map.of(
                "feature-a", new EvaluatedVariantDef(true, "B", "config-value")));
        TogglyClient variantClient = new TogglyClient(config, provider);

        VariantResult variant = variantClient.getVariant("feature-a");
        assertNotNull(variant);
        assertEquals("B", variant.getName());
        assertEquals("config-value", variant.getConfigurationValue());
        assertEquals("config-value", variantClient.getVariantValue("feature-a"));

        variantClient.close();
    }

    @Test
    void shouldReturnNullVariantWhenEntryDisabled() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        provider.setVariants(Map.of(
                "feature-a", new EvaluatedVariantDef(false, "B", "config-value")));
        TogglyClient variantClient = new TogglyClient(config, provider);

        assertNull(variantClient.getVariant("feature-a"));
        assertNull(variantClient.getVariantValue("feature-a"));

        variantClient.close();
    }

    @Test
    void shouldReturnNullVariantWhenNoVariantAssigned() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        provider.setVariants(Map.of(
                "feature-a", new EvaluatedVariantDef(true, null, null)));
        TogglyClient variantClient = new TogglyClient(config, provider);

        assertNull(variantClient.getVariant("feature-a"));

        variantClient.close();
    }

    @Test
    void shouldReturnNullVariantForMissingEntry() {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        TogglyClient variantClient = new TogglyClient(config, provider);

        assertNull(variantClient.getVariant("unknown-feature"));

        variantClient.close();
    }

    @Test
    void shouldStillEvaluateIsEnabledFromDefinitionsWhenVariantsEnabled() {
        // Dual-rail: definitions/isEnabled must not be replaced by the variants rail.
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .defaultFeatureState(false)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        Map<String, FeatureDefinition> features = new HashMap<>();
        features.put("feature-a", createAlwaysOnFeature("feature-a"));
        provider.setFeatures(features);
        // No variant entry at all — isEnabled must still come from definitions.
        TogglyClient variantClient = new TogglyClient(config, provider);

        assertTrue(variantClient.isEnabled("feature-a"));
        assertNull(variantClient.getVariant("feature-a"));

        variantClient.close();
    }

    @Test
    void shouldResolveVariantAsynchronously() throws Exception {
        TogglyConfig config = TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableVariants(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        provider.setVariants(Map.of(
                "feature-a", new EvaluatedVariantDef(true, "B", 42L)));
        TogglyClient variantClient = new TogglyClient(config, provider);

        VariantResult variant = variantClient.getVariantAsync("feature-a").get();
        assertNotNull(variant);
        assertEquals("B", variant.getName());
        assertEquals(42L, variant.getConfigurationValue());

        variantClient.close();
    }

    private FeatureDefinition createAlwaysOnFeature(String key) {
        FeatureFilter filter = FeatureFilter.alwaysOn();

        return FeatureDefinition.builder()
                .featureKey(key)
                .filters(List.of(filter))
                .build();
    }
}
