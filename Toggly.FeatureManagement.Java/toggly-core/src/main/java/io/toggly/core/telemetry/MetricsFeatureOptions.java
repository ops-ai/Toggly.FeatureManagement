package io.toggly.core.telemetry;

/**
 * Optional feature/variant correlation for business metrics.
 */
public final class MetricsFeatureOptions {

    private final String feature;
    private final String variant;

    private MetricsFeatureOptions(String feature, String variant) {
        this.feature = feature;
        this.variant = variant;
    }

    public static MetricsFeatureOptions of() {
        return new MetricsFeatureOptions(null, null);
    }

    public static MetricsFeatureOptions of(String feature) {
        return new MetricsFeatureOptions(feature, null);
    }

    public static MetricsFeatureOptions of(String feature, String variant) {
        return new MetricsFeatureOptions(feature, variant);
    }

    public String getFeature() {
        return feature;
    }

    public String getVariant() {
        return variant;
    }
}
