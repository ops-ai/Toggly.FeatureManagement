package io.toggly.core.telemetry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * POJO payload for {@code Usage.SendStats} (converted to protobuf by the gRPC client).
 */
public final class FeatureStatPayload {

    private final String appKey;
    private final String environment;
    private final Instant time;
    private final List<StatMessage> stats;
    private final int totalUniqueUsers;
    private final List<Integer> uniqueUserHashes;
    private final String instanceName;
    private final String appVersion;
    private final Instant processStartTime;

    public FeatureStatPayload(
            String appKey,
            String environment,
            Instant time,
            List<StatMessage> stats,
            int totalUniqueUsers,
            List<Integer> uniqueUserHashes,
            String instanceName,
            String appVersion,
            Instant processStartTime) {
        this.appKey = Objects.requireNonNull(appKey, "appKey");
        this.environment = Objects.requireNonNull(environment, "environment");
        this.time = Objects.requireNonNull(time, "time");
        this.stats = Collections.unmodifiableList(new ArrayList<>(stats));
        this.totalUniqueUsers = totalUniqueUsers;
        this.uniqueUserHashes = Collections.unmodifiableList(new ArrayList<>(uniqueUserHashes));
        this.instanceName = instanceName;
        this.appVersion = appVersion;
        this.processStartTime = processStartTime;
    }

    public String getAppKey() {
        return appKey;
    }

    public String getEnvironment() {
        return environment;
    }

    public Instant getTime() {
        return time;
    }

    public List<StatMessage> getStats() {
        return stats;
    }

    public int getTotalUniqueUsers() {
        return totalUniqueUsers;
    }

    public List<Integer> getUniqueUserHashes() {
        return uniqueUserHashes;
    }

    public String getInstanceName() {
        return instanceName;
    }

    public String getAppVersion() {
        return appVersion;
    }

    public Instant getProcessStartTime() {
        return processStartTime;
    }

    public static final class StatMessage {
        private final String feature;
        private final int uniqueContextIdentifierEnabledCount;
        private final int uniqueContextIdentifierDisabledCount;
        private final int uniqueUsersUsedCount;
        private final List<Integer> uniqueUserHashes;
        private final List<Integer> uniqueViewedUserHashes;
        private final Map<String, VariantStats> variantStats;

        public StatMessage(
                String feature,
                int uniqueContextIdentifierEnabledCount,
                int uniqueContextIdentifierDisabledCount,
                int uniqueUsersUsedCount,
                List<Integer> uniqueUserHashes,
                List<Integer> uniqueViewedUserHashes,
                Map<String, VariantStats> variantStats) {
            this.feature = feature;
            this.uniqueContextIdentifierEnabledCount = uniqueContextIdentifierEnabledCount;
            this.uniqueContextIdentifierDisabledCount = uniqueContextIdentifierDisabledCount;
            this.uniqueUsersUsedCount = uniqueUsersUsedCount;
            this.uniqueUserHashes = Collections.unmodifiableList(new ArrayList<>(uniqueUserHashes));
            this.uniqueViewedUserHashes =
                    Collections.unmodifiableList(new ArrayList<>(uniqueViewedUserHashes));
            this.variantStats = Collections.unmodifiableMap(variantStats);
        }

        public String getFeature() {
            return feature;
        }

        public int getUniqueContextIdentifierEnabledCount() {
            return uniqueContextIdentifierEnabledCount;
        }

        public int getUniqueContextIdentifierDisabledCount() {
            return uniqueContextIdentifierDisabledCount;
        }

        public int getUniqueUsersUsedCount() {
            return uniqueUsersUsedCount;
        }

        public List<Integer> getUniqueUserHashes() {
            return uniqueUserHashes;
        }

        public List<Integer> getUniqueViewedUserHashes() {
            return uniqueViewedUserHashes;
        }

        public Map<String, VariantStats> getVariantStats() {
            return variantStats;
        }
    }

    public static final class VariantStats {
        private final int checkCount;
        private final int requestCount;
        private final int usedCount;
        private final int viewedCount;

        public VariantStats(int checkCount, int requestCount, int usedCount, int viewedCount) {
            this.checkCount = checkCount;
            this.requestCount = requestCount;
            this.usedCount = usedCount;
            this.viewedCount = viewedCount;
        }

        public int getCheckCount() {
            return checkCount;
        }

        public int getRequestCount() {
            return requestCount;
        }

        public int getUsedCount() {
            return usedCount;
        }

        public int getViewedCount() {
            return viewedCount;
        }
    }
}
