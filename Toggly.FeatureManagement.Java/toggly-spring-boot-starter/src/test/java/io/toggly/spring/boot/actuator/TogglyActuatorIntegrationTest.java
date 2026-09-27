package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;
import org.springframework.boot.actuate.autoconfigure.endpoint.EndpointAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TogglyActuatorIntegrationTest {

    @Test
    void endpointReportsLiveDefinitionsAndRefreshResult() {
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
    void endpointAndHealthExposeSnapshotFailureWithoutThrowing() {
        SnapshotProvider failing = new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() { throw new IllegalStateException("catalog unavailable"); }

            @Override
            public FeatureSnapshot refresh() { throw new IllegalStateException("refresh unavailable"); }
        };
        try (TogglyClient client = client(failing)) {
            assertThat(new TogglyEndpoint(client).refresh())
                    .containsEntry("status", "error")
                    .containsEntry("error", "refresh unavailable");
            assertThat(new TogglyHealthIndicator(client).health().getStatus())
                    .isEqualTo(Status.DOWN);
        }
    }

    @Test
    void healthAndAutoConfigurationFollowAvailableClientAndEndpointSettings() {
        try (TogglyClient client = client(new InMemorySnapshotProvider())) {
            ApplicationContextRunner runner = new ApplicationContextRunner()
                    .withConfiguration(AutoConfigurations.of(EndpointAutoConfiguration.class,
                            TogglyActuatorAutoConfiguration.class))
                    .withPropertyValues("management.endpoints.web.exposure.include=toggly");

            runner.run(context -> {
                assertThat(context).doesNotHaveBean(TogglyEndpoint.class);
                assertThat(context).doesNotHaveBean(TogglyHealthIndicator.class);
            });
            runner.withBean(TogglyClient.class, () -> client)
                    .run(context -> {
                        assertThat(context).hasSingleBean(TogglyEndpoint.class);
                        assertThat(context).hasSingleBean(TogglyHealthIndicator.class);
                        assertThat(context.getBean(TogglyHealthIndicator.class).health().getStatus())
                                .isEqualTo(Status.UP);
                        assertThat(context.getBean(TogglyHealthIndicator.class).health().getDetails())
                                .containsEntry("featureCount", 0)
                                .containsEntry("environment", "Test");
                    });
            runner.withBean(TogglyClient.class, () -> client)
                    .withPropertyValues("management.endpoint.toggly.enabled=false",
                            "management.health.toggly.enabled=false")
                    .run(context -> {
                        assertThat(context).doesNotHaveBean(TogglyEndpoint.class);
                        assertThat(context).doesNotHaveBean(TogglyHealthIndicator.class);
                    });
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
