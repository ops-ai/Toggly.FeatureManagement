package io.toggly.core.util;

import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.model.VariantStatusOverride;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class VariantJsonRoundTripTest {

    @Test
    void catalogVariantAndAllocationRoundTripPreservesTargeting() {
        String feature = """
                {"variants":[{"name":"control","configurationValue":{"color":"blue"},"statusOverride":"None"},
                             {"name":"treatment","configurationValue":7,"statusOverride":"Enabled"}],
                 "allocation":{"defaultWhenEnabled":"control","defaultWhenDisabled":"treatment","seed":"seed",
                    "user":[{"variant":"treatment","users":["u-1","u-2"]}],
                    "group":[{"variant":"control","groups":["team"]}],
                    "percentile":[{"variant":"treatment","from":0,"to":25.5}]}}
                """;

        List<VariantDefinition> variants = VariantJson.parseVariants(feature);
        VariantAllocation allocation = VariantJson.parseAllocation(feature);

        assertThat(variants).hasSize(2);
        assertThat(variants.get(0).getConfigurationValue()).isEqualTo(Map.of("color", "blue"));
        assertThat(variants.get(1).getStatusOverride()).isEqualTo(VariantStatusOverride.ENABLED);
        assertThat(allocation.getUserAllocations().get(0).getUsers()).containsExactly("u-1", "u-2");
        assertThat(allocation.getGroupAllocations().get(0).getGroups()).containsExactly("team");
        assertThat(allocation.getPercentileAllocations().get(0).getTo()).isEqualTo(25.5);
        assertThat(allocation.getSeed()).isEqualTo("seed");

        String serialized = SimpleJson.serialize(Map.of(
                "variants", VariantJson.serializeVariants(variants),
                "allocation", VariantJson.serializeAllocation(allocation)));
        assertThat(VariantJson.parseVariants(serialized)).isEqualTo(variants);
        assertThat(VariantJson.parseAllocation(serialized)).isEqualTo(allocation);
    }

    @Test
    void malformedEntriesAreSkippedWhileUsableAllocationEntriesRemain() {
        String feature = """
                {"variants":[null,3,{}, {"name":""}, {"name":"valid","statusOverride":"Disabled"}],
                 "allocation":{"user":[null,{}, {"variant":"valid","users":["u",2,null]}],
                   "group":[3,{"variant":"valid","groups":"not-an-array"}],
                   "percentile":[{}, {"variant":"valid","from":"bad","to":"40"}]}}
                """;

        List<VariantDefinition> variants = VariantJson.parseVariants(feature);
        VariantAllocation allocation = VariantJson.parseAllocation(feature);

        assertThat(variants).singleElement().satisfies(v -> {
            assertThat(v.getName()).isEqualTo("valid");
            assertThat(v.getStatusOverride()).isEqualTo(VariantStatusOverride.DISABLED);
        });
        assertThat(allocation.getUserAllocations()).singleElement()
                .satisfies(u -> assertThat(u.getUsers()).containsExactly("u"));
        assertThat(allocation.getGroupAllocations()).singleElement()
                .satisfies(g -> assertThat(g.getGroups()).isEmpty());
        assertThat(allocation.getPercentileAllocations()).singleElement()
                .satisfies(p -> {
                    assertThat(p.getFrom()).isZero();
                    assertThat(p.getTo()).isEqualTo(40.0);
                });
        assertThat(VariantJson.parseVariants("{} ")).isEmpty();
        assertThat(VariantJson.parseAllocation("{} ")).isNull();
        assertThat(VariantJson.serializeVariants(null)).isEmpty();
    }
}
