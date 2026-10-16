package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.FeatureSnapshot;
import io.toggly.core.snapshot.SnapshotProvider;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TogglyHealthContributorSupportTest {

    @Test
    void snapshotReportsUpWithEmptyCatalog() {
        try (TogglyClient client = client(new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() {
                return FeatureSnapshot.empty();
            }

            @Override
            public FeatureSnapshot refresh() {
                return getSnapshot();
            }
        })) {
            TogglyHealthContributorSupport.Snapshot snapshot =
                    TogglyHealthContributorSupport.snapshot(client);
            assertThat(snapshot.isUp()).isTrue();
            assertThat(snapshot.featureCount()).isZero();
            assertThat(snapshot.environment()).isEqualTo("Test");
        }
    }

    @Test
    void snapshotReportsDownWhenClientFails() {
        try (TogglyClient client = client(new SnapshotProvider() {
            @Override
            public FeatureSnapshot getSnapshot() {
                throw new IllegalStateException("boom");
            }

            @Override
            public FeatureSnapshot refresh() {
                throw new IllegalStateException("boom");
            }
        })) {
            TogglyHealthContributorSupport.Snapshot snapshot =
                    TogglyHealthContributorSupport.snapshot(client);
            assertThat(snapshot.isUp()).isFalse();
            assertThat(snapshot.errorMessage()).isEqualTo("boom");
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
