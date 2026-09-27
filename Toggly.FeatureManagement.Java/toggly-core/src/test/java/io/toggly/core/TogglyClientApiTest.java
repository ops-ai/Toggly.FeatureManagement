package io.toggly.core;

import io.toggly.core.config.TogglyConfig;
import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.MetricDefinition;
import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.model.VariantStatusOverride;
import io.toggly.core.snapshot.InMemorySnapshotProvider;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import io.toggly.core.model.FeatureRequirement;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TogglyClientApiTest {

    @Test
    void conditionalAndMetricApisUseTheCurrentSnapshot() {
        FeatureDefinition enabled = FeatureDefinition.builder().featureKey("enabled")
                .filters(List.of(FeatureFilter.alwaysOn())).build();
        MetricDefinition metric = MetricDefinition.of("requests", "counter", "count");
        InMemorySnapshotProvider snapshots = new InMemorySnapshotProvider(
                Map.of("enabled", enabled), Map.of("requests", metric));
        TogglyConfig config = TogglyConfig.builder().appKey("app")
                .enableUsageTracking(false).enableMetrics(false).build();
        AtomicInteger enabledRuns = new AtomicInteger();
        AtomicInteger disabledRuns = new AtomicInteger();

        try (TogglyClient client = new TogglyClient(config, snapshots)) {
            client.ifEnabledElse("enabled", enabledRuns::incrementAndGet, disabledRuns::incrementAndGet);
            client.ifEnabledElse("missing", enabledRuns::incrementAndGet, disabledRuns::incrementAndGet);
            assertThat(enabledRuns).hasValue(1);
            assertThat(disabledRuns).hasValue(1);
            assertThat(client.getValue("enabled", () -> "yes", () -> "no")).isEqualTo("yes");
            assertThat(client.getValue("missing", () -> "yes", () -> "no")).isEqualTo("no");
            assertThat(client.getMetricDefinition("requests")).isSameAs(metric);
            assertThat(client.getAllMetrics()).containsEntry("requests", metric);
            assertThat(client.getAllFeatures()).containsEntry("enabled", enabled);
            client.refresh();
            client.refreshAsync().join();
            client.clearCache();
            assertThat(client.getAllFeatures()).isEmpty();
            assertThat(client.getAllMetrics()).isEmpty();
        }
    }

    @Test
    void asyncVariantAssignmentMatchesSyncAndRejectsMissingFeatures() {
        FeatureDefinition feature = FeatureDefinition.builder().featureKey("checkout")
                .filters(List.of(FeatureFilter.alwaysOn()))
                .variants(List.of(new VariantDefinition("treatment", "new", VariantStatusOverride.NONE)))
                .allocation(VariantAllocation.builder().defaultWhenEnabled("treatment").build())
                .build();
        InMemorySnapshotProvider snapshots = new InMemorySnapshotProvider(Map.of("checkout", feature));
        TogglyConfig config = TogglyConfig.builder().appKey("app")
                .enableUsageTracking(false).enableMetrics(false).build();

        try (TogglyClient client = new TogglyClient(config, snapshots)) {
            EvaluationContext context = EvaluationContext.forIdentity("user");
            assertThat(client.getVariantAsync("checkout").join()).isEqualTo(client.getVariant("checkout"));
            assertThat(client.getVariantAsync("checkout", context).join())
                    .isEqualTo(client.getVariant("checkout", context));
            assertThat(client.getVariantAsync("missing").join()).isNull();
            assertThat(client.getVariantAsync("").join()).isNull();
            assertThat(client.getVariant("")).isNull();
            assertThat(client.getVariantValueOptional(String.class, "checkout", context))
                    .contains("new");
            assertThat(client.getVariantValueOptional(Integer.class, "checkout")).isEmpty();
        }
    }

    @Test
    void networkProviderFailuresUseConfiguredFallbackForSyncAndAsyncChecks() {
        SnapshotProvider failing = new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() {
                throw new IllegalStateException("snapshot unavailable");
            }

            @Override
            public CompletableFuture<FeatureSnapshot> getSnapshotAsync() {
                return CompletableFuture.failedFuture(new IllegalStateException("snapshot unavailable"));
            }

            @Override
            public FeatureSnapshot refresh() {
                throw new IllegalStateException("snapshot unavailable");
            }
        };
        TogglyConfig fallback = TogglyConfig.builder().appKey("app")
                .defaultFeatureState(true)
                .enableUsageTracking(false).enableMetrics(false).build();

        try (TogglyClient client = new TogglyClient(fallback, failing)) {
            assertThat(client.isEnabled("flag")).isTrue();
            assertThat(client.isEnabledAsync("flag").join()).isTrue();
            assertThat(client.isEnabledAsync("").join()).isTrue();
            assertThat(client.gate(List.of("flag"), FeatureRequirement.ALL, false, null)).isTrue();
            assertThat(client.gate(List.of("flag"), FeatureRequirement.ANY, true, null)).isFalse();
            assertThat(client.getVariant("flag")).isNull();
            assertThat(client.getVariantAsync("flag").join()).isNull();
        }
    }

    @Test
    void invalidKeysAndBlankTelemetryNamesAreIgnored() {
        InMemorySnapshotProvider snapshots = new InMemorySnapshotProvider();
        TogglyConfig config = TogglyConfig.builder().appKey("app")
                .enableUsageTracking(false).enableMetrics(false).build();
        try (TogglyClient client = new TogglyClient(config, snapshots)) {
            assertThat(client.isEnabled(null)).isFalse();
            assertThat(client.isEnabled("")).isFalse();
            assertThat(client.isEnabledAsync(null).join()).isFalse();
            assertThat(client.getVariant(null)).isNull();
            client.recordUsage(null);
            client.recordUsage("");
            client.recordView(null);
            client.recordView("");
            client.measure(null, 1);
            client.measure("", 1);
            client.incrementCounter(null);
            client.incrementCounter("");
            client.observe(null, 1);
            client.observe("", 1);
            client.flushTelemetry();
            assertThat(snapshots.getSnapshot().isEmpty()).isTrue();
        }
        assertThatThrownBy(() -> new TogglyClient(null, snapshots)).hasMessageContaining("Configuration");
        assertThatThrownBy(() -> new TogglyClient(TogglyConfig.builder().build(), snapshots))
                .hasMessageContaining("App key");
    }
}
