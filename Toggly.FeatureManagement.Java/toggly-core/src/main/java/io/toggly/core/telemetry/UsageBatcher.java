package io.toggly.core.telemetry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * In-memory feature usage aggregator. Prefer {@code variantStats} over legacy scalars
 * (matches .NET / Node / Go send shape).
 */
public final class UsageBatcher {

    private static final String FEATURE_PARAM = "feature";
    private static final String DEFAULT_VARIANT = "enabled";
    private static final String DISABLED_VARIANT = "disabled";

    private final String appKey;
    private final String environment;
    private final String instanceName;
    private final String appVersion;
    private final Instant processStartTime;

    private final Object lock = new Object();
    private Map<String, UsageBatchSnapshot.FeatureUsageAgg> perFeature = new HashMap<>();
    private Set<Integer> appUnique = new HashSet<>();
    private int definitionCacheHits;
    private int definitionCacheMisses;

    public UsageBatcher(String appKey, String environment, String instanceName, String appVersion) {
        this(appKey, environment, instanceName, appVersion, Instant.now());
    }

    public UsageBatcher(
            String appKey,
            String environment,
            String instanceName,
            String appVersion,
            Instant processStartTime) {
        this.appKey = Objects.requireNonNull(appKey, "appKey");
        this.environment = Objects.requireNonNull(environment, "environment");
        this.instanceName = instanceName;
        this.appVersion = appVersion;
        this.processStartTime = processStartTime != null ? processStartTime : Instant.now();
    }

    /** Count a definition-refresh outcome served from local/cache (not a new revision). */
    public void recordDefinitionCacheHit() {
        synchronized (lock) {
            definitionCacheHits++;
        }
    }

    /** Count a definition-refresh that applied a new revision from the network. */
    public void recordDefinitionCacheMiss() {
        synchronized (lock) {
            definitionCacheMisses++;
        }
    }

    public void recordCheck(String feature, boolean enabled, String identity) {
        recordCheck(feature, enabled, identity, null, false);
    }

    public void recordCheck(
            String feature,
            boolean enabled,
            String identity,
            String variant,
            boolean uniqueRequest) {
        Objects.requireNonNull(feature, FEATURE_PARAM);
        synchronized (lock) {
            UsageBatchSnapshot.FeatureUsageAgg agg = get(feature);
            String name;
            if (variant != null) {
                name = variant;
            } else if (enabled) {
                name = DEFAULT_VARIANT;
            } else {
                name = DISABLED_VARIANT;
            }
            UsageBatchSnapshot.VariantStatsAgg stats = getVariant(agg, name);
            stats.checkCount++;
            if (uniqueRequest) {
                stats.requestCount++;
            }
            if (identity != null && !identity.isEmpty()) {
                int hash = IdentityHasher.hashIdentity(identity);
                appUnique.add(hash);
                if (enabled) {
                    agg.uniqueUsersEnabled.add(hash);
                } else {
                    agg.uniqueUsersDisabled.add(hash);
                }
            }
        }
    }

    public void recordUsage(String feature, String identity) {
        recordUsage(feature, identity, DEFAULT_VARIANT);
    }

    public void recordUsage(String feature, String identity, String variant) {
        Objects.requireNonNull(feature, FEATURE_PARAM);
        String v = variant != null && !variant.isEmpty() ? variant : DEFAULT_VARIANT;
        synchronized (lock) {
            UsageBatchSnapshot.FeatureUsageAgg agg = get(feature);
            getVariant(agg, v).usedCount++;
            if (identity != null && !identity.isEmpty()) {
                int hash = IdentityHasher.hashIdentity(identity);
                appUnique.add(hash);
                agg.uniqueUsersUsed.add(hash);
                agg.uniqueUserHashes.add(hash);
            }
        }
    }

    public void recordView(String feature, String identity) {
        recordView(feature, identity, DEFAULT_VARIANT);
    }

    public void recordView(String feature, String identity, String variant) {
        Objects.requireNonNull(feature, FEATURE_PARAM);
        String v = variant != null && !variant.isEmpty() ? variant : DEFAULT_VARIANT;
        synchronized (lock) {
            UsageBatchSnapshot.FeatureUsageAgg agg = get(feature);
            getVariant(agg, v).viewedCount++;
            if (identity != null && !identity.isEmpty()) {
                int hash = IdentityHasher.hashIdentity(identity);
                appUnique.add(hash);
                agg.uniqueUsersViewed.add(hash);
                agg.uniqueViewedUserHashes.add(hash);
            }
        }
    }

    public void recordUsageError(String feature, String variant, int count) {
        if (count <= 0) {
            return;
        }
        Objects.requireNonNull(feature, FEATURE_PARAM);
        String v = variant != null && !variant.isEmpty() ? variant : DEFAULT_VARIANT;
        synchronized (lock) {
            getVariant(get(feature), v).errorCount += count;
        }
    }

    public void recordUsageDuration(String feature, long durationMs, String variant, boolean failed) {
        if (durationMs <= 0) {
            return;
        }
        Objects.requireNonNull(feature, FEATURE_PARAM);
        String v = variant != null && !variant.isEmpty() ? variant : DEFAULT_VARIANT;
        synchronized (lock) {
            UsageBatchSnapshot.VariantStatsAgg stats = getVariant(get(feature), v);
            if (failed) {
                stats.errorDurationSumMs += durationMs;
            } else {
                stats.durationSumMs += durationMs;
            }
        }
    }

    public boolean isEmpty() {
        synchronized (lock) {
            return perFeature.isEmpty()
                    && appUnique.isEmpty()
                    && definitionCacheHits == 0
                    && definitionCacheMisses == 0;
        }
    }

    /**
     * Build the SendStats payload and clear pending state, returning a snapshot for failed-send
     * restore (merge into any concurrent records).
     */
    public DrainedUsage exportAndReset() {
        synchronized (lock) {
            if (isEmptyUnlocked()) {
                return null;
            }

            UsageBatchSnapshot snapshot = UsageBatchSnapshot.cloneOf(
                    perFeature, appUnique, definitionCacheHits, definitionCacheMisses);

            Instant now = Instant.now();
            List<FeatureStatPayload.StatMessage> stats = new ArrayList<>();
            for (Map.Entry<String, UsageBatchSnapshot.FeatureUsageAgg> entry : perFeature.entrySet()) {
                UsageBatchSnapshot.FeatureUsageAgg agg = entry.getValue();
                Map<String, FeatureStatPayload.VariantStats> variantStats = new LinkedHashMap<>();
                for (Map.Entry<String, UsageBatchSnapshot.VariantStatsAgg> vs :
                        agg.variantStats.entrySet()) {
                    UsageBatchSnapshot.VariantStatsAgg s = vs.getValue();
                    if (s.checkCount > 0
                            || s.requestCount > 0
                            || s.usedCount > 0
                            || s.viewedCount > 0
                            || s.errorCount > 0
                            || s.durationSumMs > 0
                            || s.errorDurationSumMs > 0) {
                        variantStats.put(
                                vs.getKey(),
                                new FeatureStatPayload.VariantStats(
                                        s.checkCount,
                                        s.requestCount,
                                        s.usedCount,
                                        s.viewedCount,
                                        s.errorCount,
                                        s.durationSumMs,
                                        s.errorDurationSumMs));
                    }
                }
                stats.add(new FeatureStatPayload.StatMessage(
                        entry.getKey(),
                        agg.uniqueUsersEnabled.size(),
                        agg.uniqueUsersDisabled.size(),
                        agg.uniqueUsersUsed.size(),
                        new ArrayList<>(agg.uniqueUserHashes),
                        new ArrayList<>(agg.uniqueViewedUserHashes),
                        variantStats));
            }

            Integer hits = definitionCacheHits > 0 ? definitionCacheHits : null;
            Integer misses = definitionCacheMisses > 0 ? definitionCacheMisses : null;

            FeatureStatPayload payload = new FeatureStatPayload(
                    appKey,
                    environment,
                    now,
                    stats,
                    appUnique.size(),
                    new ArrayList<>(appUnique),
                    instanceName,
                    appVersion,
                    processStartTime,
                    hits,
                    misses);

            perFeature = new HashMap<>();
            appUnique = new HashSet<>();
            definitionCacheHits = 0;
            definitionCacheMisses = 0;
            return new DrainedUsage(payload, snapshot);
        }
    }

    public FeatureStatPayload buildAndReset() {
        DrainedUsage drained = exportAndReset();
        return drained != null ? drained.payload : null;
    }

    /**
     * Merge a drained snapshot back into pending state after sendStats failure.
     * Additive so counters recorded while the send was in flight are preserved.
     */
    public void restore(UsageBatchSnapshot snapshot) {
        Objects.requireNonNull(snapshot, "snapshot");
        synchronized (lock) {
            definitionCacheHits += snapshot.definitionCacheHits;
            definitionCacheMisses += snapshot.definitionCacheMisses;
            appUnique.addAll(snapshot.appUnique);

            for (Map.Entry<String, UsageBatchSnapshot.FeatureUsageAgg> entry :
                    snapshot.perFeature.entrySet()) {
                UsageBatchSnapshot.FeatureUsageAgg snapAgg = entry.getValue();
                UsageBatchSnapshot.FeatureUsageAgg agg = get(entry.getKey());
                for (Map.Entry<String, UsageBatchSnapshot.VariantStatsAgg> vs :
                        snapAgg.variantStats.entrySet()) {
                    UsageBatchSnapshot.VariantStatsAgg snapStats = vs.getValue();
                    UsageBatchSnapshot.VariantStatsAgg stats = getVariant(agg, vs.getKey());
                    stats.checkCount += snapStats.checkCount;
                    stats.requestCount += snapStats.requestCount;
                    stats.usedCount += snapStats.usedCount;
                    stats.viewedCount += snapStats.viewedCount;
                    stats.errorCount += snapStats.errorCount;
                    stats.durationSumMs += snapStats.durationSumMs;
                    stats.errorDurationSumMs += snapStats.errorDurationSumMs;
                }
                agg.uniqueUsersEnabled.addAll(snapAgg.uniqueUsersEnabled);
                agg.uniqueUsersDisabled.addAll(snapAgg.uniqueUsersDisabled);
                agg.uniqueUsersUsed.addAll(snapAgg.uniqueUsersUsed);
                agg.uniqueUsersViewed.addAll(snapAgg.uniqueUsersViewed);
                agg.uniqueUserHashes.addAll(snapAgg.uniqueUserHashes);
                agg.uniqueViewedUserHashes.addAll(snapAgg.uniqueViewedUserHashes);
            }
        }
    }

    private boolean isEmptyUnlocked() {
        return perFeature.isEmpty()
                && appUnique.isEmpty()
                && definitionCacheHits == 0
                && definitionCacheMisses == 0;
    }

    private UsageBatchSnapshot.FeatureUsageAgg get(String feature) {
        return perFeature.computeIfAbsent(feature, k -> new UsageBatchSnapshot.FeatureUsageAgg());
    }

    private static UsageBatchSnapshot.VariantStatsAgg getVariant(
            UsageBatchSnapshot.FeatureUsageAgg agg, String variant) {
        return agg.variantStats.computeIfAbsent(variant, k -> new UsageBatchSnapshot.VariantStatsAgg());
    }

    /** Result of {@link #exportAndReset()}: wire payload plus restore snapshot. */
    public static final class DrainedUsage {
        public final FeatureStatPayload payload;
        public final UsageBatchSnapshot snapshot;

        DrainedUsage(FeatureStatPayload payload, UsageBatchSnapshot snapshot) {
            this.payload = payload;
            this.snapshot = snapshot;
        }
    }
}
