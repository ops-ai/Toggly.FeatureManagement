package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureValueType;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Tests for the catalog {@code valueType} field and typed flag getters
 * (OPS-2102): {@code getStringValue}/{@code getNumberValue}/
 * {@code getJsonValue}/{@code getDateTimeValue}.
 */
class TypedFlagValueTest {

    private TogglyConfig defaultConfig() {
        return TogglyConfig.builder()
                .appKey("test-app-key")
                .environment("Test")
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
    }

    private TogglyClient clientWith(FeatureDefinition definition) {
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider();
        provider.setFeatures(Map.of(definition.getFeatureKey(), definition));
        return new TogglyClient(defaultConfig(), provider);
    }

    @Test
    void shouldReturnStringValueWhenDeclaredTypeMatches() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("greeting")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .valueType(FeatureValueType.STRING)
                .value("hello")
                .build();
        TogglyClient client = clientWith(definition);

        assertEquals("hello", client.getStringValue("greeting"));

        client.close();
    }

    @Test
    void shouldSoftNullStringValueOnDeclaredMismatch() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("limit")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .valueType(FeatureValueType.NUMBER)
                .value(42)
                .build();
        TogglyClient client = clientWith(definition);

        assertNull(client.getStringValue("limit"));
        assertEquals(42.0, client.getNumberValue("limit"));

        client.close();
    }

    @Test
    void shouldReturnJsonValueWhenDeclaredTypeMatches() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("config")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .valueType(FeatureValueType.JSON)
                .value(Map.of("nested", Map.of("flag", true)))
                .build();
        TogglyClient client = clientWith(definition);

        Object json = client.getJsonValue("config");
        assertEquals(Map.of("nested", Map.of("flag", true)), json);

        client.close();
    }

    @Test
    void shouldParseDateTimeValueFromIso8601() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("launch-at")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .valueType(FeatureValueType.DATETIME)
                .value("2026-06-01T00:00:00Z")
                .build();
        TogglyClient client = clientWith(definition);

        OffsetDateTime decoded = client.getDateTimeValue("launch-at");
        assertEquals(2026, decoded.getYear());
        assertEquals(6, decoded.getMonthValue());
        assertEquals(1, decoded.getDayOfMonth());

        client.close();
    }

    @Test
    void shouldSoftNullDateTimeValueOnUnparsableInput() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("launch-at")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .valueType(FeatureValueType.DATETIME)
                .value("not-a-date")
                .build();
        TogglyClient client = clientWith(definition);

        assertNull(client.getDateTimeValue("launch-at"));

        client.close();
    }

    @Test
    void shouldSoftNullOnDisabledFlag() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("greeting")
                .filters(List.of())
                .valueType(FeatureValueType.STRING)
                .value("hello")
                .build();
        TogglyClient client = clientWith(definition);

        assertNull(client.getStringValue("greeting"));

        client.close();
    }

    @Test
    void shouldSoftNullOnMissingFeature() {
        TogglyClient client = new TogglyClient(defaultConfig(), new InMemorySnapshotProvider());

        assertNull(client.getStringValue("unknown"));
        assertNull(client.getNumberValue("unknown"));
        assertNull(client.getJsonValue("unknown"));
        assertNull(client.getDateTimeValue("unknown"));

        client.close();
    }

    @Test
    void shouldDecodeLegacyCatalogWithoutDeclaredValueType() {
        FeatureDefinition definition = FeatureDefinition.builder()
                .featureKey("greeting")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .value("hello")
                .build();
        TogglyClient client = clientWith(definition);

        assertEquals("hello", client.getStringValue("greeting"));

        client.close();
    }
}
