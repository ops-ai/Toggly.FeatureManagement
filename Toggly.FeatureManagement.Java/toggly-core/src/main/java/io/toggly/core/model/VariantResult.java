package io.toggly.core.model;

import java.util.Objects;

/**
 * Assigned variant name, configuration value, and effective enabled state
 * for a feature, returned by {@code TogglyClient#getVariant}.
 *
 * <p>Catalog-local: assigned by the local MF-parity allocator
 * ({@code io.toggly.core.eval.VariantAllocator}) directly from
 * {@code FeatureDefinition#getVariants()} / {@code getAllocation()} — never
 * fetched separately from the definitions payload.</p>
 *
 * <p>{@link #isEnabled()} reflects the feature's effective enabled state
 * <em>after</em> applying the assigned variant's
 * {@link VariantStatusOverride}, matching
 * {@code Microsoft.FeatureManagement}'s {@code GetVariantAsync} semantics.
 * It may differ from {@code TogglyClient#isEnabled}, which stays purely
 * filter-based and is never affected by {@code StatusOverride}.</p>
 */
public final class VariantResult {

    private final String name;
    private final Object configurationValue;
    private final boolean enabled;

    /**
     * Creates a variant result.
     *
     * @param name assigned variant name
     * @param configurationValue configuration payload for the variant
     * @param enabled effective enabled state after {@code StatusOverride}
     */
    public VariantResult(String name, Object configurationValue, boolean enabled) {
        this.name = name;
        this.configurationValue = configurationValue;
        this.enabled = enabled;
    }

    /**
     * Variant name assigned by the local allocator.
     */
    public String getName() {
        return name;
    }

    /**
     * Configuration payload for the variant.
     */
    public Object getConfigurationValue() {
        return configurationValue;
    }

    /**
     * Effective enabled state after applying the variant's
     * {@link VariantStatusOverride}, if any.
     */
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VariantResult that = (VariantResult) o;
        return enabled == that.enabled
                && Objects.equals(name, that.name)
                && Objects.equals(configurationValue, that.configurationValue);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, configurationValue, enabled);
    }

    @Override
    public String toString() {
        return "VariantResult{" +
                "name='" + name + '\'' +
                ", configurationValue=" + configurationValue +
                ", enabled=" + enabled +
                '}';
    }
}
