package io.toggly.core.model;

/**
 * Controls whether an assigned variant overrides a feature's effective
 * enabled/disabled state, matching {@code Microsoft.FeatureManagement}'s
 * {@code StatusOverride} on {@code FeatureFlagVariant}.
 */
public enum VariantStatusOverride {

    /**
     * The variant does not affect whether the feature is considered enabled
     * or disabled.
     */
    NONE,

    /**
     * When this variant is assigned, the feature is evaluated as enabled
     * (even if it was otherwise disabled).
     */
    ENABLED,

    /**
     * When this variant is assigned, the feature is evaluated as disabled
     * (even if it was otherwise enabled).
     */
    DISABLED;

    /**
     * Parses a string value (e.g. {@code "None"} / {@code "Enabled"} /
     * {@code "Disabled"} from the wire) into a {@link VariantStatusOverride}.
     *
     * @param value the string value
     * @return the parsed override, defaults to {@link #NONE} if null or unrecognized
     */
    public static VariantStatusOverride fromString(String value) {
        if (value == null) return NONE;
        switch (value.trim().toLowerCase()) {
            case "enabled":
                return ENABLED;
            case "disabled":
                return DISABLED;
            case "none":
            default:
                return NONE;
        }
    }
}
