package io.toggly.core.eval;

/**
 * Why {@link VariantAllocator} assigned (or did not assign) a variant,
 * matching {@code Microsoft.FeatureManagement}'s
 * {@code VariantAssignmentReason} enum.
 */
public enum VariantAssignmentReason {

    /** No variants are defined for the feature; the pipeline never ran. */
    NONE("None"),

    /** Assigned via a direct user-identity match. */
    USER("User"),

    /** Assigned via a direct group match. */
    GROUP("Group"),

    /** Assigned via a percentile-bucket match. */
    PERCENTILE("Percentile"),

    /** Assigned via {@code Allocation.defaultWhenEnabled} (feature enabled, no other match). */
    DEFAULT_WHEN_ENABLED("DefaultWhenEnabled"),

    /** Assigned via {@code Allocation.defaultWhenDisabled} (feature disabled). */
    DEFAULT_WHEN_DISABLED("DefaultWhenDisabled");

    private final String wireName;

    VariantAssignmentReason(String wireName) {
        this.wireName = wireName;
    }

    /**
     * The MF-parity wire name for this reason (e.g. {@code "DefaultWhenEnabled"}).
     */
    public String getWireName() {
        return wireName;
    }
}
