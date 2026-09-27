package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OnFeatureConditionTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(FeatureBeans.class);

    @Test
    void propertyDefaultsSelectAllAnyAndNegatedBeansBeforeClientExists() {
        runner.withPropertyValues(
                "toggly.feature-defaults.first=true",
                "toggly.feature-defaults.second=false")
                .run(context -> {
                    assertThat(context).hasBean("allDisabled");
                    assertThat(context).hasBean("anyEnabled");
                    assertThat(context).hasBean("negatedAll");
                    assertThat(context).doesNotHaveBean("allEnabled");
                    assertThat(context).doesNotHaveBean("negatedAny");
                });
    }

    @Test
    void globalDefaultAppliesToMissingFeatureKeys() {
        runner.withPropertyValues("toggly.default-feature-state=true")
                .run(context -> {
                    assertThat(context).hasBean("allEnabled");
                    assertThat(context).hasBean("anyEnabled");
                    assertThat(context).doesNotHaveBean("allDisabled");
                });
    }

    @Test
    void registeredClientTakesPrecedenceOverPropertyDefaults() {
        FeatureDefinition enabled = FeatureDefinition.builder()
                .featureKey("first").addFilter(FeatureFilter.alwaysOn()).build();
        TogglyConfig config = TogglyConfig.builder().appKey("test-key")
                .enableUsageTracking(false).enableMetrics(false)
                .registerContextsOnStartup(false).build();
        try (TogglyClient client = new TogglyClient(config,
                new InMemorySnapshotProvider(Map.of("first", enabled)))) {
            runner.withBean(TogglyClient.class, () -> client)
                    .withPropertyValues(
                            "toggly.feature-defaults.first=false",
                            "toggly.feature-defaults.second=true")
                    .run(context -> {
                        assertThat(context).hasBean("anyEnabled");
                        assertThat(context).hasBean("negatedAll");
                        assertThat(context).hasBean("allDisabled");
                        assertThat(context).doesNotHaveBean("allEnabled");
                        assertThat(context).doesNotHaveBean("negatedAny");
                    });
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class FeatureBeans {
        @Bean
        @ConditionalOnFeature({"first", "second"})
        String allEnabled() { return "all"; }

        @Bean
        @ConditionalOnFeature(value = {"first", "second"}, matchAll = false)
        Integer anyEnabled() { return 1; }

        @Bean
        @ConditionalOnFeature(value = {"first", "second"}, matchIfDisabled = true)
        Long negatedAll() { return 2L; }

        @Bean
        @ConditionalOnFeature(value = {"first", "second"}, matchAll = false, matchIfDisabled = true)
        Boolean negatedAny() { return true; }

        @Bean
        @ConditionalOnFeature(value = "second", matchIfDisabled = true)
        Double allDisabled() { return 3.0; }
    }
}
