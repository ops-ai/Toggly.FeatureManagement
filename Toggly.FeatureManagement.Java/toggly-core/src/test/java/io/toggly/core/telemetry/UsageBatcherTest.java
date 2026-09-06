package io.toggly.core.telemetry;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UsageBatcherTest {

    @Test
    void aggregatesChecksIntoVariantStatsEnabledDisabled() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", "host-1", "1.2.3");

        batcher.recordCheck("FeatureA", true, "user-1");
        batcher.recordCheck("FeatureA", true, "user-1");
        batcher.recordCheck("FeatureA", false, "user-2");
        batcher.recordUsage("FeatureA", "user-1");
        batcher.recordView("FeatureA", "user-3");

        FeatureStatPayload payload = batcher.buildAndReset();
        assertThat(payload).isNotNull();
        assertThat(payload.getAppKey()).isEqualTo("app");
        assertThat(payload.getEnvironment()).isEqualTo("Production");
        assertThat(payload.getInstanceName()).isEqualTo("host-1");
        assertThat(payload.getAppVersion()).isEqualTo("1.2.3");
        assertThat(payload.getProcessStartTime()).isNotNull();
        assertThat(payload.getStats()).hasSize(1);

        FeatureStatPayload.StatMessage stat = payload.getStats().get(0);
        assertThat(stat.getFeature()).isEqualTo("FeatureA");
        assertThat(stat.getVariantStats().get("enabled").getCheckCount()).isEqualTo(2);
        assertThat(stat.getVariantStats().get("enabled").getRequestCount()).isZero();
        assertThat(stat.getVariantStats().get("enabled").getUsedCount()).isEqualTo(1);
        assertThat(stat.getVariantStats().get("enabled").getViewedCount()).isEqualTo(1);
        assertThat(stat.getVariantStats().get("disabled").getCheckCount()).isEqualTo(1);
        assertThat(stat.getUniqueContextIdentifierEnabledCount()).isEqualTo(1);
        assertThat(stat.getUniqueContextIdentifierDisabledCount()).isEqualTo(1);
        assertThat(stat.getUniqueUsersUsedCount()).isEqualTo(1);
        assertThat(stat.getUniqueUserHashes()).contains(IdentityHasher.hashIdentity("user-1"));
        assertThat(stat.getUniqueViewedUserHashes()).contains(IdentityHasher.hashIdentity("user-3"));
        assertThat(payload.getUniqueUserHashes()).containsExactlyInAnyOrder(
                IdentityHasher.hashIdentity("user-1"),
                IdentityHasher.hashIdentity("user-2"),
                IdentityHasher.hashIdentity("user-3"));

        assertThat(batcher.buildAndReset()).isNull();
    }

    @Test
    void incrementsRequestCountOnlyWhenUniqueRequest() {
        UsageBatcher batcher = new UsageBatcher("app", "Production", null, null);

        batcher.recordCheck("FeatureA", true, "user-1", null, true);
        batcher.recordCheck("FeatureA", true, "user-1", null, false);
        batcher.recordCheck("FeatureA", false, "user-2", null, true);

        FeatureStatPayload payload = batcher.buildAndReset();
        assertThat(payload.getStats().get(0).getVariantStats().get("enabled").getCheckCount()).isEqualTo(2);
        assertThat(payload.getStats().get(0).getVariantStats().get("enabled").getRequestCount()).isEqualTo(1);
        assertThat(payload.getStats().get(0).getVariantStats().get("disabled").getCheckCount()).isEqualTo(1);
        assertThat(payload.getStats().get(0).getVariantStats().get("disabled").getRequestCount()).isEqualTo(1);
    }
}
