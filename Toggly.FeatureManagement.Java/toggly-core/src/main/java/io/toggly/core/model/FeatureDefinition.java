package io.toggly.core.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Represents a feature flag definition from the Toggly server.
 */
public final class FeatureDefinition {

    private final String featureKey;
    private final List<FeatureFilter> filters;
    private final FeatureRequirement requirementType;
    private final String contextKind;
    private final FeatureRequirement contextRequirementType;
    private final boolean securedFeature;
    private final List<MetricDefinition> metrics;

    private FeatureDefinition(Builder builder) {
        this.featureKey = builder.featureKey;
        this.filters = Collections.unmodifiableList(new ArrayList<>(builder.filters));
        this.requirementType = builder.requirementType;
        this.contextKind = builder.contextKind;
        this.contextRequirementType = builder.contextRequirementType;
        this.securedFeature = builder.securedFeature;
        this.metrics = builder.metrics != null
                ? Collections.unmodifiableList(new ArrayList<>(builder.metrics))
                : Collections.emptyList();
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getFeatureKey() {
        return featureKey;
    }

    public List<FeatureFilter> getFilters() {
        return filters;
    }

    public FeatureRequirement getRequirementType() {
        return requirementType;
    }

    public String getContextKind() {
        return contextKind;
    }

    public FeatureRequirement getContextRequirementType() {
        return contextRequirementType;
    }

    public boolean isSecuredFeature() {
        return securedFeature;
    }

    public List<MetricDefinition> getMetrics() {
        return metrics;
    }

    public static final class Builder {
        private String featureKey;
        private List<FeatureFilter> filters = new ArrayList<>();
        private FeatureRequirement requirementType = FeatureRequirement.ANY;
        private String contextKind;
        private FeatureRequirement contextRequirementType;
        private boolean securedFeature = false;
        private List<MetricDefinition> metrics;

        private Builder() {}

        public Builder featureKey(String featureKey) {
            this.featureKey = featureKey;
            return this;
        }

        public Builder filters(List<FeatureFilter> filters) {
            this.filters = filters != null ? new ArrayList<>(filters) : new ArrayList<>();
            return this;
        }

        public Builder addFilter(FeatureFilter filter) {
            this.filters.add(filter);
            return this;
        }

        public Builder requirementType(FeatureRequirement requirementType) {
            this.requirementType = requirementType != null ? requirementType : FeatureRequirement.ANY;
            return this;
        }

        public Builder contextKind(String contextKind) {
            this.contextKind = contextKind;
            return this;
        }

        public Builder contextRequirementType(FeatureRequirement contextRequirementType) {
            this.contextRequirementType = contextRequirementType;
            return this;
        }

        public Builder securedFeature(boolean securedFeature) {
            this.securedFeature = securedFeature;
            return this;
        }

        public Builder metrics(List<MetricDefinition> metrics) {
            this.metrics = metrics;
            return this;
        }

        public FeatureDefinition build() {
            Objects.requireNonNull(featureKey, "featureKey is required");
            return new FeatureDefinition(this);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        FeatureDefinition that = (FeatureDefinition) o;
        return securedFeature == that.securedFeature &&
                Objects.equals(featureKey, that.featureKey) &&
                Objects.equals(filters, that.filters) &&
                requirementType == that.requirementType;
    }

    @Override
    public int hashCode() {
        return Objects.hash(featureKey, filters, requirementType, securedFeature);
    }

    @Override
    public String toString() {
        return "FeatureDefinition{" +
                "featureKey='" + featureKey + '\'' +
                ", filters=" + filters.size() +
                ", requirementType=" + requirementType +
                ", securedFeature=" + securedFeature +
                '}';
    }
}
