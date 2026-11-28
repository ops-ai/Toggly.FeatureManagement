package io.toggly.core.util;

import io.toggly.core.model.FeatureValueType;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the soft-decode helpers backing the typed flag value
 * getters (OPS-2102), independent of {@code TogglyClient}.
 */
class FeatureValueCodecTest {

    @Test
    void decodeStringAcceptsStringAndRejectsMismatch() {
        assertThat(FeatureValueCodec.decodeString("hello", null)).isEqualTo("hello");
        assertThat(FeatureValueCodec.decodeString(42, null)).isNull();
        assertThat(FeatureValueCodec.decodeString("hello", FeatureValueType.NUMBER)).isNull();
    }

    @Test
    void decodeNumberAcceptsNumbersAndNumericStringsNeverBooleans() {
        assertThat(FeatureValueCodec.decodeNumber(42, null)).isEqualTo(42.0);
        assertThat(FeatureValueCodec.decodeNumber("3.14", null)).isEqualTo(3.14);
        assertThat(FeatureValueCodec.decodeNumber(true, null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber("not-a-number", null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber("   ", null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber(Double.NaN, null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber(Double.POSITIVE_INFINITY, null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber(new Object(), null)).isNull();
        assertThat(FeatureValueCodec.decodeNumber(42, FeatureValueType.STRING)).isNull();
    }

    @Test
    void decodeJsonAcceptsMapsListsAndJsonStringsOnly() {
        assertThat(FeatureValueCodec.decodeJson(Map.of("a", 1), null)).isEqualTo(Map.of("a", 1));
        assertThat(FeatureValueCodec.decodeJson("{\"a\": 1}", null)).isEqualTo(Map.of("a", 1L));
        assertThat(FeatureValueCodec.decodeJson(null, null)).isNull();
        assertThat(FeatureValueCodec.decodeJson("not json", null)).isNull();
        assertThat(FeatureValueCodec.decodeJson("\"a plain string\"", null)).isNull();
        assertThat(FeatureValueCodec.decodeJson(42, null)).isNull();
        assertThat(FeatureValueCodec.decodeJson(Map.of("a", 1), FeatureValueType.STRING)).isNull();
    }

    @Test
    void decodeDateTimeParsesIso8601AndSoftNullsOnBadInput() {
        OffsetDateTime decoded = FeatureValueCodec.decodeDateTime("2026-01-15T10:30:00Z", null);
        assertThat(decoded).isNotNull();
        assertThat(decoded.getYear()).isEqualTo(2026);
        assertThat(decoded.getMonthValue()).isEqualTo(1);
        assertThat(decoded.getDayOfMonth()).isEqualTo(15);

        OffsetDateTime existing = OffsetDateTime.parse("2025-03-01T00:00:00Z");
        assertThat(FeatureValueCodec.decodeDateTime(existing, null)).isEqualTo(existing);
        assertThat(FeatureValueCodec.decodeDateTime(existing.toInstant(), null)).isEqualTo(existing);

        assertThat(FeatureValueCodec.decodeDateTime("not-a-date", null)).isNull();
        assertThat(FeatureValueCodec.decodeDateTime("   ", null)).isNull();
        assertThat(FeatureValueCodec.decodeDateTime(12345, null)).isNull();
        assertThat(FeatureValueCodec.decodeDateTime("2026-01-15T10:30:00Z", FeatureValueType.STRING)).isNull();
    }

    @Test
    void fromStringParsesRecognizedWireLiterals() {
        assertThat(FeatureValueType.fromString(null)).isNull();
        assertThat(FeatureValueType.fromString("")).isNull();
        assertThat(FeatureValueType.fromString("   ")).isNull();
        assertThat(FeatureValueType.fromString("boolean")).isEqualTo(FeatureValueType.BOOLEAN);
        assertThat(FeatureValueType.fromString("STRING")).isEqualTo(FeatureValueType.STRING);
        assertThat(FeatureValueType.fromString("number")).isEqualTo(FeatureValueType.NUMBER);
        assertThat(FeatureValueType.fromString("json")).isEqualTo(FeatureValueType.JSON);
        assertThat(FeatureValueType.fromString("datetime")).isEqualTo(FeatureValueType.DATETIME);
        assertThat(FeatureValueType.fromString("mystery")).isEqualTo(FeatureValueType.UNKNOWN);
    }

    @Test
    void legacyNullDeclaredTypeAllowsAnyDecodeAttempt() {
        assertThat(FeatureValueCodec.valueTypeMatches(null, FeatureValueType.STRING)).isTrue();
        assertThat(FeatureValueCodec.valueTypeMatches(FeatureValueType.NUMBER, FeatureValueType.STRING)).isFalse();
        assertThat(FeatureValueCodec.valueTypeMatches(FeatureValueType.STRING, FeatureValueType.STRING)).isTrue();
    }
}
