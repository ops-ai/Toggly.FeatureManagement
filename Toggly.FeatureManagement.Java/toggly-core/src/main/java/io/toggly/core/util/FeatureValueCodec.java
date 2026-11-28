package io.toggly.core.util;

import io.toggly.core.model.FeatureValueType;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * Soft-decodes a resolved feature's value by its declared catalog
 * {@link FeatureValueType} (OPS-2102).
 *
 * <p>Mirrors the wire contract used across Toggly SDKs: a feature definition
 * may carry a {@code valueType} of {@code boolean | string | number | json |
 * datetime}. These helpers never throw solely for a shape mismatch and never
 * return a wrong-typed value — they soft-null ({@code null}) on a declared-type
 * mismatch or a decode failure. Legacy catalogs without a declared
 * {@code valueType} (a {@code null} {@code declared} argument) still attempt
 * the decode so older flags keep working.</p>
 *
 * <p>Reuses the same soft-null shape as {@link VariantValueCodec}
 * (OPS-1365), applied to the flag's own value rather than a variant's
 * configuration payload.</p>
 */
public final class FeatureValueCodec {

    private FeatureValueCodec() {
    }

    /**
     * Returns whether a typed getter for {@code requested} may attempt a decode.
     *
     * @param declared  the feature's declared value type, or null for legacy catalogs
     * @param requested the type the caller is asking for
     * @return true if the decode should be attempted
     */
    public static boolean valueTypeMatches(FeatureValueType declared, FeatureValueType requested) {
        return declared == null || declared == requested;
    }

    /**
     * Soft-decodes {@code raw} as a {@link String}.
     *
     * @param raw      the untyped resolved value
     * @param declared the feature's declared value type, or null
     * @return the string, or null on mismatch / non-string input
     */
    public static String decodeString(Object raw, FeatureValueType declared) {
        if (!valueTypeMatches(declared, FeatureValueType.STRING)) {
            return null;
        }
        return raw instanceof String string ? string : null;
    }

    /**
     * Soft-decodes {@code raw} as a finite {@link Double}.
     *
     * @param raw      the untyped resolved value
     * @param declared the feature's declared value type, or null
     * @return the number, or null on mismatch / non-numeric / unparsable input
     */
    public static Double decodeNumber(Object raw, FeatureValueType declared) {
        if (!valueTypeMatches(declared, FeatureValueType.NUMBER)) {
            return null;
        }
        if (raw instanceof Boolean) {
            // Never treat true/false as 1/0.
            return null;
        }
        if (raw instanceof Number number) {
            double d = number.doubleValue();
            return Double.isFinite(d) ? d : null;
        }
        if (raw instanceof String string && !string.isBlank()) {
            try {
                double d = Double.parseDouble(string.trim());
                return Double.isFinite(d) ? d : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    /**
     * Soft-decodes {@code raw} as a JSON object/array value tree ({@code Map}/
     * {@code List}).
     *
     * @param raw      the untyped resolved value
     * @param declared the feature's declared value type, or null
     * @return the parsed value tree, or null on mismatch / undecodable input
     */
    public static Object decodeJson(Object raw, FeatureValueType declared) {
        if (!valueTypeMatches(declared, FeatureValueType.JSON)) {
            return null;
        }
        if (raw == null) {
            return null;
        }
        if (raw instanceof java.util.Map || raw instanceof java.util.List) {
            return raw;
        }
        if (raw instanceof String string) {
            Object parsed;
            try {
                parsed = SimpleJson.parseValue(string, new int[]{0});
            } catch (RuntimeException ignored) {
                return null;
            }
            return (parsed instanceof java.util.Map || parsed instanceof java.util.List) ? parsed : null;
        }
        return null;
    }

    /**
     * Soft-decodes {@code raw} as an {@link OffsetDateTime} parsed from an
     * ISO-8601 string.
     *
     * @param raw      the untyped resolved value
     * @param declared the feature's declared value type, or null
     * @return the parsed datetime, or null on mismatch / unparsable input
     */
    public static OffsetDateTime decodeDateTime(Object raw, FeatureValueType declared) {
        if (!valueTypeMatches(declared, FeatureValueType.DATETIME)) {
            return null;
        }
        if (raw instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime;
        }
        if (raw instanceof Instant instant) {
            return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
        }
        if (!(raw instanceof String string) || string.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(string.trim(), DateTimeFormatter.ISO_DATE_TIME);
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }
}
