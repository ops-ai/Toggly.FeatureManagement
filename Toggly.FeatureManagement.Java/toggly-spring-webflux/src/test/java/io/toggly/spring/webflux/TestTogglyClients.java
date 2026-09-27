package io.toggly.spring.webflux;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.InMemorySnapshotProvider;

import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;

final class TestTogglyClients {

    private TestTogglyClients() {
    }

    static TogglyClient clientWith(String... enabledFeatures) {
        Map<String, FeatureDefinition> features = Arrays.stream(enabledFeatures)
                .collect(Collectors.toMap(feature -> feature, TestTogglyClients::enabledFeature));
        TogglyConfig config = TogglyConfig.builder()
                .appKey("webflux-test")
                .environment("Test")
                .enableAutoRefresh(false)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .build();
        return new TogglyClient(config, new InMemorySnapshotProvider(features));
    }

    static EvaluationContext context() {
        return EvaluationContext.forIdentity("alex");
    }

    static FeatureDefinition enabledFeature(String key) {
        return FeatureDefinition.builder()
                .featureKey(key)
                .filters(java.util.List.of(FeatureFilter.alwaysOn()))
                .build();
    }
}
