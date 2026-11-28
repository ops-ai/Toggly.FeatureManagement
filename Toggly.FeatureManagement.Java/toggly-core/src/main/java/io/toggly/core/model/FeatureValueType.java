package io.toggly.core.model;

/**
 * Declared catalog value type for a feature flag (OPS-2102).
 *
 * <p>Catalogs that predate this field carry no {@code valueType}; the typed
 * flag getters on {@code TogglyClient} still attempt a decode in that case
 * (soft-null on failure). A recognized-but-different declared type always
 * rejects a mismatched typed getter.</p>
 */
public enum FeatureValueType {

    BOOLEAN,
    STRING,
    NUMBER,
    JSON,
    DATETIME,

    /** A wire value present but not one of the recognized literals above. */
    UNKNOWN;

    /**
     * Parses the wire {@code valueType} string into a {@link FeatureValueType}.
     *
     * @param value the wire value, e.g. {@code "string"} / {@code "datetime"}
     * @return the parsed type, or {@code null} when {@code value} is null/blank
     *     (legacy catalogs predating this field)
     */
    public static FeatureValueType fromString(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        switch (value.trim().toLowerCase()) {
            case "boolean":
                return BOOLEAN;
            case "string":
                return STRING;
            case "number":
                return NUMBER;
            case "json":
                return JSON;
            case "datetime":
                return DATETIME;
            default:
                return UNKNOWN;
        }
    }
}
