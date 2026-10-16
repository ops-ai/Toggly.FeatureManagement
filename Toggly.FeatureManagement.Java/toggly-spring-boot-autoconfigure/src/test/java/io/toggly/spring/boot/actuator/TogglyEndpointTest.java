package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TogglyEndpointTest {

    @Test
    void reportsLiveDefinitionsAndRefreshResult() {
        FeatureDefinition checkout = FeatureDefinition.builder()
                .featureKey("checkout").addFilter(FeatureFilter.alwaysOn()).build();
        InMemorySnapshotProvider provider = new InMemorySnapshotProvider(Map.of("checkout", checkout));
        try (TogglyClient client = client(provider)) {
            TogglyEndpoint endpoint = new TogglyEndpoint(client);

            assertThat(endpoint.features()).containsEntry("environment", "Test")
                    .containsEntry("featureCount", 1)
                    .containsEntry("features", Map.of("checkout", true));
            assertThat(endpoint.feature("checkout")).containsEntry("enabled", true)
                    .containsEntry("exists", true)
                    .containsEntry("filterCount", 1);
            assertThat(endpoint.feature("missing")).containsEntry("enabled", false)
                    .containsEntry("exists", false);

            provider.setFeatures(Map.of());
            assertThat(endpoint.refresh()).containsEntry("status", "refreshed")
                    .containsEntry("featureCount", 0);
        }
    }

    @Test
    void refreshSurfacesSnapshotErrorsWithoutThrowing() {
        SnapshotProvider failing = new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() {
                throw new IllegalStateException("catalog unavailable");
            }

            @Override
            public FeatureSnapshot refresh() {
                throw new IllegalStateException("refresh unavailable");
            }
        };
        try (TogglyClient client = client(failing)) {
            assertThat(new TogglyEndpoint(client).refresh())
                    .containsEntry("status", "error")
                    .containsEntry("error", "refresh unavailable");
        }
    }

    private static TogglyClient client(SnapshotProvider provider) {
        TogglyConfig config = TogglyConfig.builder().appKey("test-key")
                .environment("Test")
                .enableUsageTracking(false).enableMetrics(false)
                .registerContextsOnStartup(false).build();
        return new TogglyClient(config, provider);
    }
}
