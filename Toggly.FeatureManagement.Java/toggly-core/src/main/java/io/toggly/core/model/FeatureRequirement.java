package io.toggly.core.model;

/**
 * Specifies how multiple filters in a feature definition should be combined.
 */
public enum FeatureRequirement {

    /**
     * All filters must pass for the feature to be enabled.
     */
    ALL,

    /**
     * Any (at least one) filter must pass for the feature to be enabled.
     */
    ANY;

    /**
     * Parses a string value to a FeatureRequirement.
     *
     * @param value the string value
     * @return the FeatureRequirement, defaults to ANY if value is null or unrecognized
     */
    public static FeatureRequirement fromString(String value) {
        if (value == null) return ANY;
        switch (value.toLowerCase()) {
            case "all":
                return ALL;
            case "any":
            default:
                return ANY;
        }
    }
}
