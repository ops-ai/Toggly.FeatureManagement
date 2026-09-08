package io.toggly.core.telemetry;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Immutable drain snapshot for restoring a usage batch after {@code sendStats} failure.
 */
final class UsageBatchSnapshot {

    final Map<String, FeatureUsageAgg> perFeature;
    final Set<Integer> appUnique;
    final int definitionCacheHits;
    final int definitionCacheMisses;

    UsageBatchSnapshot(
            Map<String, FeatureUsageAgg> perFeature,
            Set<Integer> appUnique,
            int definitionCacheHits,
            int definitionCacheMisses) {
        this.perFeature = perFeature;
        this.appUnique = appUnique;
        this.definitionCacheHits = definitionCacheHits;
        this.definitionCacheMisses = definitionCacheMisses;
    }

    static UsageBatchSnapshot cloneOf(
            Map<String, FeatureUsageAgg> perFeature,
            Set<Integer> appUnique,
            int definitionCacheHits,
            int definitionCacheMisses) {
        Map<String, FeatureUsageAgg> cloned = new HashMap<>();
        for (Map.Entry<String, FeatureUsageAgg> entry : perFeature.entrySet()) {
            cloned.put(entry.getKey(), entry.getValue().copy());
        }
        return new UsageBatchSnapshot(
                cloned, new HashSet<>(appUnique), definitionCacheHits, definitionCacheMisses);
    }

    /** Mutable aggregation clone target used by {@link UsageBatcher}. */
    static final class FeatureUsageAgg {
        final Map<String, VariantStatsAgg> variantStats = new HashMap<>();
        final Set<Integer> uniqueUsersEnabled = new HashSet<>();
        final Set<Integer> uniqueUsersDisabled = new HashSet<>();
        final Set<Integer> uniqueUsersUsed = new HashSet<>();
        final Set<Integer> uniqueUsersViewed = new HashSet<>();
        final Set<Integer> uniqueUserHashes = new HashSet<>();
        final Set<Integer> uniqueViewedUserHashes = new HashSet<>();

        FeatureUsageAgg copy() {
            FeatureUsageAgg copy = new FeatureUsageAgg();
            for (Map.Entry<String, VariantStatsAgg> entry : variantStats.entrySet()) {
                VariantStatsAgg src = entry.getValue();
                VariantStatsAgg dst = new VariantStatsAgg();
                dst.checkCount = src.checkCount;
                dst.requestCount = src.requestCount;
                dst.usedCount = src.usedCount;
                dst.viewedCount = src.viewedCount;
                copy.variantStats.put(entry.getKey(), dst);
            }
            copy.uniqueUsersEnabled.addAll(uniqueUsersEnabled);
            copy.uniqueUsersDisabled.addAll(uniqueUsersDisabled);
            copy.uniqueUsersUsed.addAll(uniqueUsersUsed);
            copy.uniqueUsersViewed.addAll(uniqueUsersViewed);
            copy.uniqueUserHashes.addAll(uniqueUserHashes);
            copy.uniqueViewedUserHashes.addAll(uniqueViewedUserHashes);
            return copy;
        }
    }

    static final class VariantStatsAgg {
        int checkCount;
        int requestCount;
        int usedCount;
        int viewedCount;
    }
}
