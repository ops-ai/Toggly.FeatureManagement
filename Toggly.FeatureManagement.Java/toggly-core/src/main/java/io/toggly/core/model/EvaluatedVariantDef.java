package io.toggly.core.model;

import java.util.Objects;

/**
 * Server-evaluated variant entry for a single feature flag, as returned by the
 * {@code evaluated-variants-signed} endpoint.
 *
 * <p>Distinct from the local {@link FeatureDefinition} evaluation used by
 * {@code isEnabled}. This is populated only when {@code enableVariants} is
 * true and is consumed by {@code TogglyClient#getVariant} /
 * {@code TogglyClient#getVariantValue}.</p>
 */
public final class EvaluatedVariantDef {

    private final boolean enabled;
    private final String variant;
    private final Object configurationValue;

    public EvaluatedVariantDef(boolean enabled, String variant, Object configurationValue) {
        this.enabled = enabled;
        this.variant = variant;
        this.configurationValue = configurationValue;
    }

    /**
     * Whether the feature is enabled for the evaluated context.
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * Assigned variant name, or {@code null} when no variant is assigned.
     */
    public String getVariant() {
        return variant;
    }

    /**
     * Configuration value for the assigned variant. Shape depends on the feature.
     */
    public Object getConfigurationValue() {
        return configurationValue;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        EvaluatedVariantDef that = (EvaluatedVariantDef) o;
        return enabled == that.enabled
                && Objects.equals(variant, that.variant)
                && Objects.equals(configurationValue, that.configurationValue);
    }

    @Override
    public int hashCode() {
        return Objects.hash(enabled, variant, configurationValue);
    }

    @Override
    public String toString() {
        return "EvaluatedVariantDef{" +
                "enabled=" + enabled +
                ", variant='" + variant + '\'' +
                ", configurationValue=" + configurationValue +
                '}';
    }
}
