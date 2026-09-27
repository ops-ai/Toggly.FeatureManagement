package io.toggly.core.model;

import io.toggly.core.context.RequestContext;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CoreModelValueTest {

    @Test
    void featureDefinitionSnapshotsMutableInputsAndKeepsDefaults() {
        List<FeatureFilter> filters = new ArrayList<>(List.of(FeatureFilter.alwaysOn()));
        List<MetricDefinition> metrics = new ArrayList<>(List.of(MetricDefinition.of("visits", "counter", "count")));
        FeatureDefinition feature = FeatureDefinition.builder().featureKey("checkout")
                .filters(filters).metrics(metrics).securedFeature(true).build();
        filters.clear();
        metrics.clear();

        assertThat(feature.getFilters()).hasSize(1);
        assertThat(feature.getMetrics()).hasSize(1);
        assertThat(feature.isSecuredFeature()).isTrue();
        assertThat(feature.getRequirementType()).isEqualTo(FeatureRequirement.ANY);
        assertThat(feature.getVariants()).isEmpty();
        assertThat(feature.getAllocation()).isNull();
        assertThatThrownBy(() -> feature.getFilters().clear())
                .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> feature.getMetrics().clear())
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(FeatureDefinition.builder().featureKey("empty")
                .filters(null).metrics(null).variants(null).requirementType(null).build()
                .getFilters()).isEmpty();
        assertThatThrownBy(() -> FeatureDefinition.builder().build())
                .isInstanceOf(NullPointerException.class);
        assertThat(feature.toString()).contains("checkout");
    }

    @Test
    void metricAndRequestValuesHaveStableEqualityAndDisplayFields() {
        MetricDefinition metric = MetricDefinition.of("visits", "counter", "count");
        MetricDefinition equal = MetricDefinition.of("visits", "counter", "count");
        RequestContext request = RequestContext.builder()
                .userAgent("browser").acceptLanguage("en-US").country("US").build();
        RequestContext equalRequest = RequestContext.of("browser", "en-US", "US");

        assertThat(metric).isEqualTo(equal).hasSameHashCodeAs(equal);
        assertThat(metric).isNotEqualTo(null).isNotEqualTo("visits");
        assertThat(metric.getMetricKey()).isEqualTo("visits");
        assertThat(metric.getType()).isEqualTo("counter");
        assertThat(metric.getUnit()).isEqualTo("count");
        assertThat(metric.toString()).contains("visits", "counter");
        assertThatThrownBy(() -> MetricDefinition.of(null, "counter", "count"))
                .isInstanceOf(NullPointerException.class);

        assertThat(request).isEqualTo(equalRequest).hasSameHashCodeAs(equalRequest);
        assertThat(request).isNotEqualTo(null).isNotEqualTo("browser");
        assertThat(request.getUserAgent()).isEqualTo("browser");
        assertThat(request.getAcceptLanguage()).isEqualTo("en-US");
        assertThat(request.getCountry()).isEqualTo("US");
        assertThat(request.toString()).contains("browser", "en-US", "US");
    }
}
