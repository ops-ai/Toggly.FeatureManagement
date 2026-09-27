package io.toggly.core.context;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TogglyEntityContextTest {

    @Test
    void attributesAreCaseInsensitiveForLookupAndPreserveExplicitNulls() {
        Map<String, Object> values = new HashMap<>();
        values.put("Region", "US");
        values.put("nullable", null);
        values.put(null, "ignored");
        TogglyEntityContext entity = new TogglyEntityContext("Order", "o-1", values);
        values.clear();

        assertThat(entity.getAttribute("Region")).isEqualTo("US");
        assertThat(entity.getAttribute("region")).isEqualTo("US");
        assertThat(entity.getAttribute("unknown")).isNull();
        assertThat(entity.getAttribute(null)).isNull();
        assertThat(entity.containsAttribute("REGION")).isTrue();
        assertThat(entity.containsAttribute(null)).isFalse();
        assertThat(entity.hasAttribute("nullable")).isTrue();
        assertThat(entity.hasAttribute("unknown")).isFalse();
        assertThat(entity.getAttributes()).doesNotContainKey(null);
        assertThatThrownBy(() -> entity.getAttributes().clear())
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(entity.getKind()).isEqualTo("Order");
        assertThat(entity.getKey()).isEqualTo("o-1");
        assertThat(entity.toString()).contains("order", "o-1");
    }

    @Test
    void nullInputsUseEmptyEntityAndValueEquality() {
        TogglyEntityContext empty = new TogglyEntityContext(null, null, null);
        TogglyEntityContext same = new TogglyEntityContext("", "", Map.of());

        assertThat(empty.getKind()).isEmpty();
        assertThat(empty.getKey()).isEmpty();
        assertThat(empty.getAttributes()).isEmpty();
        assertThat(empty).isEqualTo(same).hasSameHashCodeAs(same);
        assertThat(empty).isEqualTo(empty).isNotEqualTo(null).isNotEqualTo("empty");
    }
}
