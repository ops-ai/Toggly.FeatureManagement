package io.toggly.core.telemetry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * POJO payload for {@code Metrics.SendMetrics}.
 */
public final class MetricStatPayload {

    private final String appKey;
    private final String environment;
    private final Instant time;
    private final List<MetricValues> stats;
    private final List<MetricValues> counters;
    private final List<ObservationMessage> observations;
    private final String instanceName;

    public MetricStatPayload(
            String appKey,
            String environment,
            Instant time,
            List<MetricValues> stats,
            List<MetricValues> counters,
            List<ObservationMessage> observations,
            String instanceName) {
        this.appKey = Objects.requireNonNull(appKey, "appKey");
        this.environment = Objects.requireNonNull(environment, "environment");
        this.time = Objects.requireNonNull(time, "time");
        this.stats = Collections.unmodifiableList(new ArrayList<>(stats));
        this.counters = Collections.unmodifiableList(new ArrayList<>(counters));
        this.observations = Collections.unmodifiableList(new ArrayList<>(observations));
        this.instanceName = instanceName;
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

    public List<MetricValues> getStats() {
        return stats;
    }

    public List<MetricValues> getCounters() {
        return counters;
    }

    public List<ObservationMessage> getObservations() {
        return observations;
    }

    public String getInstanceName() {
        return instanceName;
    }

    public static final class MetricValues {
        private final String metric;
        private final String feature;
        private final Map<String, Double> variantValues;

        public MetricValues(String metric, String feature, Map<String, Double> variantValues) {
            this.metric = metric;
            this.feature = feature;
            this.variantValues = Collections.unmodifiableMap(new LinkedHashMap<>(variantValues));
        }

        public String getMetric() {
            return metric;
        }

        public String getFeature() {
            return feature;
        }

        public Map<String, Double> getVariantValues() {
            return variantValues;
        }
    }

    public static final class ObservationMessage {
        private final Instant time;
        private final String metric;
        private final String feature;
        private final Map<String, Double> variantValues;

        public ObservationMessage(
                Instant time, String metric, String feature, Map<String, Double> variantValues) {
            this.time = time;
            this.metric = metric;
            this.feature = feature;
            this.variantValues = variantValues;
        }

        public Instant getTime() {
            return time;
        }

        public String getMetric() {
            return metric;
        }

        public String getFeature() {
            return feature;
        }

        public Map<String, Double> getVariantValues() {
            return variantValues;
        }
    }
}
