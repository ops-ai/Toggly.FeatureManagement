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

    private final String appKey;
    private final String environment;
    private final String instanceName;
    private final String appVersion;
    private final Instant processStartTime;

    private final Object lock = new Object();
    private Map<String, FeatureUsageAgg> perFeature = new HashMap<>();
    private Set<Integer> appUnique = new HashSet<>();

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

    public void recordCheck(String feature, boolean enabled, String identity) {
        recordCheck(feature, enabled, identity, null, false);
    }

    public void recordCheck(
            String feature,
            boolean enabled,
            String identity,
            String variant,
            boolean uniqueRequest) {
        Objects.requireNonNull(feature, "feature");
        synchronized (lock) {
            FeatureUsageAgg agg = get(feature);
            String name = variant != null ? variant : (enabled ? "enabled" : "disabled");
            VariantStatsAgg stats = getVariant(agg, name);
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
        recordUsage(feature, identity, "enabled");
    }

    public void recordUsage(String feature, String identity, String variant) {
        Objects.requireNonNull(feature, "feature");
        String v = variant != null && !variant.isEmpty() ? variant : "enabled";
        synchronized (lock) {
            FeatureUsageAgg agg = get(feature);
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
        recordView(feature, identity, "enabled");
    }

    public void recordView(String feature, String identity, String variant) {
        Objects.requireNonNull(feature, "feature");
        String v = variant != null && !variant.isEmpty() ? variant : "enabled";
        synchronized (lock) {
            FeatureUsageAgg agg = get(feature);
            getVariant(agg, v).viewedCount++;
            if (identity != null && !identity.isEmpty()) {
                int hash = IdentityHasher.hashIdentity(identity);
                appUnique.add(hash);
                agg.uniqueUsersViewed.add(hash);
                agg.uniqueViewedUserHashes.add(hash);
            }
        }
    }

    public boolean isEmpty() {
        synchronized (lock) {
            return perFeature.isEmpty() && appUnique.isEmpty();
        }
    }

    public FeatureStatPayload buildAndReset() {
        synchronized (lock) {
            if (perFeature.isEmpty() && appUnique.isEmpty()) {
                return null;
            }

            Instant now = Instant.now();
            List<FeatureStatPayload.StatMessage> stats = new ArrayList<>();
            for (Map.Entry<String, FeatureUsageAgg> entry : perFeature.entrySet()) {
                FeatureUsageAgg agg = entry.getValue();
                Map<String, FeatureStatPayload.VariantStats> variantStats = new LinkedHashMap<>();
                for (Map.Entry<String, VariantStatsAgg> vs : agg.variantStats.entrySet()) {
                    VariantStatsAgg s = vs.getValue();
                    if (s.checkCount > 0 || s.requestCount > 0 || s.usedCount > 0 || s.viewedCount > 0) {
                        variantStats.put(
                                vs.getKey(),
                                new FeatureStatPayload.VariantStats(
                                        s.checkCount, s.requestCount, s.usedCount, s.viewedCount));
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

            FeatureStatPayload payload = new FeatureStatPayload(
                    appKey,
                    environment,
                    now,
                    stats,
                    appUnique.size(),
                    new ArrayList<>(appUnique),
                    instanceName,
                    appVersion,
                    processStartTime);

            perFeature = new HashMap<>();
            appUnique = new HashSet<>();
            return payload;
        }
    }

    private FeatureUsageAgg get(String feature) {
        return perFeature.computeIfAbsent(feature, k -> new FeatureUsageAgg());
    }

    private static VariantStatsAgg getVariant(FeatureUsageAgg agg, String variant) {
        return agg.variantStats.computeIfAbsent(variant, k -> new VariantStatsAgg());
    }

    private static final class VariantStatsAgg {
        int checkCount;
        int requestCount;
        int usedCount;
        int viewedCount;
    }

    private static final class FeatureUsageAgg {
        final Map<String, VariantStatsAgg> variantStats = new HashMap<>();
        final Set<Integer> uniqueUsersEnabled = new HashSet<>();
        final Set<Integer> uniqueUsersDisabled = new HashSet<>();
        final Set<Integer> uniqueUsersUsed = new HashSet<>();
        final Set<Integer> uniqueUsersViewed = new HashSet<>();
        final Set<Integer> uniqueUserHashes = new HashSet<>();
        final Set<Integer> uniqueViewedUserHashes = new HashSet<>();
    }
}
