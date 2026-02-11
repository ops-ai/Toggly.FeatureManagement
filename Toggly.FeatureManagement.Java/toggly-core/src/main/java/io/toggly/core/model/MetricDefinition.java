package io.toggly.core.model;

import java.util.Objects;

/**
 * Represents a metric definition associated with a feature flag.
 */
public final class MetricDefinition {

    private final String name;
    private final String type;
    private final String unit;

    private MetricDefinition(String name, String type, String unit) {
        this.name = name;
        this.type = type;
        this.unit = unit;
    }

    public static MetricDefinition of(String name, String type, String unit) {
        Objects.requireNonNull(name, "name is required");
        return new MetricDefinition(name, type, unit);
    }

    public String getName() {
        return name;
    }

    /**
     * Returns the metric key (alias for getName for compatibility).
     *
     * @return the metric key/name
     */
    public String getMetricKey() {
        return name;
    }

    public String getType() {
        return type;
    }

    public String getUnit() {
        return unit;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        MetricDefinition that = (MetricDefinition) o;
        return Objects.equals(name, that.name) &&
                Objects.equals(type, that.type) &&
                Objects.equals(unit, that.unit);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, type, unit);
    }

    @Override
    public String toString() {
        return "MetricDefinition{" +
                "name='" + name + '\'' +
                ", type='" + type + '\'' +
                ", unit='" + unit + '\'' +
                '}';
    }
}
