package io.toggly.core.snapshot;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.MetricDefinition;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FeatureSnapshotTest {

    @Test
    void emptySnapshotHasSafeDefaults() {
        FeatureSnapshot snapshot = FeatureSnapshot.empty();

        assertThat(snapshot.isEmpty()).isTrue();
        assertThat(snapshot.getFeatures()).isEmpty();
        assertThat(snapshot.getMetrics()).isEmpty();
        assertThat(snapshot.getTimestamp()).isNotNull();
        assertThat(snapshot.getFeature("missing")).isNull();
        assertThat(snapshot.hasSignatureMetadata()).isFalse();
    }

    @Test
    void signedCopyRetainsDefinitionsAndExactRawPayload() {
        FeatureDefinition feature = FeatureDefinition.builder().featureKey("flag").build();
        MetricDefinition metric = MetricDefinition.of("visits", "counter", "count");
        Instant timestamp = Instant.parse("2026-01-01T00:00:00Z");
        FeatureSnapshot original = new FeatureSnapshot(
                new HashMap<>(Map.of("flag", feature)),
                new HashMap<>(Map.of("visits", metric)), timestamp, "etag");

        FeatureSnapshot signed = original.withSignature("signature", "kid", 42L, "[{\"raw\":true}]");

        assertThat(original.hasSignatureMetadata()).isFalse();
        assertThat(signed.hasSignatureMetadata()).isTrue();
        assertThat(signed.getFeature("flag")).isSameAs(feature);
        assertThat(signed.getMetrics()).containsEntry("visits", metric);
        assertThat(signed.getTimestamp()).isEqualTo(timestamp);
        assertThat(signed.getEtag()).isEqualTo("etag");
        assertThat(signed.getSignature()).isEqualTo("signature");
        assertThat(signed.getKeyId()).isEqualTo("kid");
        assertThat(signed.getSignedTimestamp()).isEqualTo(42L);
        assertThat(signed.getSignedDefsJson()).isEqualTo("[{\"raw\":true}]");
        Map<String, FeatureDefinition> immutableFeatures = signed.getFeatures();
        Map<String, MetricDefinition> immutableMetrics = signed.getMetrics();
        assertThatThrownBy(immutableFeatures::clear).isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(immutableMetrics::clear).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void equalityIgnoresCaptureTimeButIncludesSignatureMetadata() {
        FeatureSnapshot first = new FeatureSnapshot(Map.of(), Map.of(), Instant.EPOCH, "etag");
        FeatureSnapshot second = new FeatureSnapshot(Map.of(), Map.of(), Instant.now(), "etag");

        assertThat(first).isEqualTo(second).hasSameHashCodeAs(second)
                .isNotNull()
                .isNotEqualTo(second.withSignature("sig", "kid", 1L, "[]"))
                .isNotEqualTo(new FeatureSnapshot(Map.of(), Map.of(), Instant.EPOCH, "other"));
    }
}
