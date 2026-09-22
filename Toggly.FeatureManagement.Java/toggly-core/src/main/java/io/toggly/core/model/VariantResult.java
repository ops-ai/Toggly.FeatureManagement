package io.toggly.core.model;

import java.util.Objects;

/**
 * Assigned variant name and configuration value for a feature, returned by
 * {@code TogglyClient#getVariant} when {@code enableVariants} is true and the
 * feature has an active variant assignment.
 *
 * <p>Matches JS/Python/.NET/Go semantics: never returned unless the feature is
 * effectively enabled, the evaluated entry is {@code enabled == true}, and a
 * non-empty {@code variant} name is present.</p>
 */
public final class VariantResult {

    private final String name;
    private final Object configurationValue;

    public VariantResult(String name, Object configurationValue) {
        this.name = name;
        this.configurationValue = configurationValue;
    }

    /**
     * Variant name assigned by the server.
     */
    public String getName() {
        return name;
    }

    /**
     * Optional configuration payload for the variant.
     */
    public Object getConfigurationValue() {
        return configurationValue;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VariantResult that = (VariantResult) o;
        return Objects.equals(name, that.name)
                && Objects.equals(configurationValue, that.configurationValue);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, configurationValue);
    }

    @Override
    public String toString() {
        return "VariantResult{" +
                "name='" + name + '\'' +
                ", configurationValue=" + configurationValue +
                '}';
    }
}
