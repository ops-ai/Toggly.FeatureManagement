package io.toggly.core.model;

import java.util.Objects;

/**
 * A named variant of a feature flag, as defined in the catalog (definitions
 * payload), matching {@code Microsoft.FeatureManagement}'s
 * {@code FeatureFlagVariant} schema.
 *
 * <p>Catalog-local: parsed directly from {@link FeatureDefinition#getVariants()}
 * so {@code TogglyClient#getVariant} can assign variants without a network
 * round-trip beyond the definitions fetch itself.</p>
 */
public final class VariantDefinition {

    private final String name;
    private final Object configurationValue;
    private final VariantStatusOverride statusOverride;

    /**
     * Creates a variant definition.
     *
     * @param name unique name identifying this variant within the feature
     * @param configurationValue configuration payload (scalar, object, or array); may be null
     * @param statusOverride status override; null is treated as {@link VariantStatusOverride#NONE}
     */
    public VariantDefinition(String name, Object configurationValue, VariantStatusOverride statusOverride) {
        this.name = Objects.requireNonNull(name, "name is required");
        this.configurationValue = configurationValue;
        this.statusOverride = statusOverride != null ? statusOverride : VariantStatusOverride.NONE;
    }

    /**
     * Unique name identifying this variant within the feature.
     */
    public String getName() {
        return name;
    }

    /**
     * Configuration payload for this variant. Shape depends on the feature
     * (scalar, JSON object, or JSON array).
     */
    public Object getConfigurationValue() {
        return configurationValue;
    }

    /**
     * Whether this variant overrides the feature's effective enabled state
     * when assigned.
     */
    public VariantStatusOverride getStatusOverride() {
        return statusOverride;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VariantDefinition that = (VariantDefinition) o;
        return Objects.equals(name, that.name)
                && Objects.equals(configurationValue, that.configurationValue)
                && statusOverride == that.statusOverride;
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, configurationValue, statusOverride);
    }

    @Override
    public String toString() {
        return "VariantDefinition{" +
                "name='" + name + '\'' +
                ", configurationValue=" + configurationValue +
                ", statusOverride=" + statusOverride +
                '}';
    }
}
