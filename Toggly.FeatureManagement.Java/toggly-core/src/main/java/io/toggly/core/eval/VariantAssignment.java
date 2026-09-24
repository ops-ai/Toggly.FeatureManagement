package io.toggly.core.eval;

import io.toggly.core.model.VariantDefinition;

/**
 * Result of {@link VariantAllocator#assign}: the assigned variant name (if
 * any), its resolved {@link VariantDefinition} (for configuration value /
 * status override), the effective enabled state after
 * {@code StatusOverride}, and why the assignment was made.
 */
public final class VariantAssignment {

    private final String variantName;
    private final VariantDefinition variantDefinition;
    private final boolean enabled;
    private final VariantAssignmentReason reason;

    public VariantAssignment(
            String variantName,
            VariantDefinition variantDefinition,
            boolean enabled,
            VariantAssignmentReason reason) {
        this.variantName = variantName;
        this.variantDefinition = variantDefinition;
        this.enabled = enabled;
        this.reason = reason;
    }

    /**
     * Creates a "no assignment" result carrying only the effective enabled
     * state (no variant defined, or no default configured for the branch
     * that ran).
     */
    public static VariantAssignment none(boolean enabled, VariantAssignmentReason reason) {
        return new VariantAssignment(null, null, enabled, reason);
    }

    /**
     * Assigned variant name, or null if no variant was assigned.
     */
    public String getVariantName() {
        return variantName;
    }

    /**
     * The resolved {@link VariantDefinition} for {@link #getVariantName()},
     * or null if no variant was assigned, or the assigned name did not match
     * any configured variant.
     */
    public VariantDefinition getVariantDefinition() {
        return variantDefinition;
    }

    /**
     * Effective enabled state after applying the assigned variant's
     * {@code StatusOverride} (or the feature's original filter-based enabled
     * state when no override applies).
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * Why this assignment was made.
     */
    public VariantAssignmentReason getReason() {
        return reason;
    }
}
