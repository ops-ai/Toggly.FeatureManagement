package io.toggly.core.model;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FeatureFilterTest {

    @Test
    void factoryFiltersKeepTypedParametersAndDoNotExposeMutableInput() {
        Map<String, Object> values = new HashMap<>(Map.of("rate", "12.5", "count", 7));
        FeatureFilter filter = FeatureFilter.of("Custom", values);
        values.clear();

        assertThat(filter.getName()).isEqualTo("Custom");
        assertThat(filter.getDoubleParameter("rate", 0)).isEqualTo(12.5);
        assertThat(filter.getIntParameter("count", 0)).isEqualTo(7);
        assertThat(filter.getStringParameter("count")).isEqualTo("7");
        assertThat(filter.getIntParameter("missing", 9)).isEqualTo(9);
        assertThat(filter.getDoubleParameter("missing", 9)).isEqualTo(9);
        assertThatThrownBy(() -> filter.getParameters().put("new", true))
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(filter).isEqualTo(FeatureFilter.of("Custom", Map.of("rate", "12.5", "count", 7)))
                .hasSameHashCodeAs(FeatureFilter.of("Custom", Map.of("rate", "12.5", "count", 7)));
    }

    @Test
    void invalidNumericParametersFallBackWithoutDisablingEvaluation() {
        FeatureFilter filter = FeatureFilter.of("Custom", Map.of("bad", "not-a-number"));

        assertThat(filter.getDoubleParameter("bad", 1.5)).isEqualTo(1.5);
        assertThat(filter.getIntParameter("bad", 3)).isEqualTo(3);
        assertThat(filter.getStringParameter("missing")).isNull();
        assertThat(FeatureFilter.percentage(50).getDoubleParameter("Value", 0)).isEqualTo(50);
        assertThat(FeatureFilter.targetingUsers("u-1").getStringParameter("users")).isEqualTo("u-1");
        assertThat(FeatureFilter.targetingGroups("g-1").getStringParameter("groups")).isEqualTo("g-1");
        assertThat(FeatureFilter.timeWindow(null, "end").getParameters()).containsOnlyKeys("End");
        assertThat(FeatureFilter.alwaysOn().getParameters()).isEmpty();
        assertThatThrownBy(() -> FeatureFilter.of(null, null)).isInstanceOf(NullPointerException.class);
    }
}
