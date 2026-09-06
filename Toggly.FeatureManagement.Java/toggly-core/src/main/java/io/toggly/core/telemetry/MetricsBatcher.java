package io.toggly.core.telemetry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * In-memory business metrics aggregator using {@code variantValues} maps (.NET / Node / Go parity).
 */
public final class MetricsBatcher {

    private final String appKey;
    private final String environment;
    private final String instanceName;

    private final Object lock = new Object();
    private Map<String, Map<String, Double>> measures = new HashMap<>();
    private Map<String, Map<String, Double>> counters = new HashMap<>();
    private List<Observation> observations = new ArrayList<>();

    public MetricsBatcher(String appKey, String environment, String instanceName) {
        this.appKey = Objects.requireNonNull(appKey, "appKey");
        this.environment = Objects.requireNonNull(environment, "environment");
        this.instanceName = instanceName;
    }

    public void measure(String metric, double value) {
        measure(metric, value, null);
    }

    public void measure(String metric, double value, MetricsFeatureOptions options) {
        Objects.requireNonNull(metric, "metric");
        synchronized (lock) {
            addToMap(measures, metric, value, options);
        }
    }

    public void incrementCounter(String metric) {
        incrementCounter(metric, 1.0, null);
    }

    public void incrementCounter(String metric, double value) {
        incrementCounter(metric, value, null);
    }

    public void incrementCounter(String metric, double value, MetricsFeatureOptions options) {
        Objects.requireNonNull(metric, "metric");
        synchronized (lock) {
            addToMap(counters, metric, value, options);
        }
    }

    public void observe(String metric, double value) {
        observe(metric, value, null);
    }

    public void observe(String metric, double value, MetricsFeatureOptions options) {
        Objects.requireNonNull(metric, "metric");
        String variant = resolveVariant(options);
        String feature = options != null ? options.getFeature() : null;
        synchronized (lock) {
            observations.add(new Observation(Instant.now(), metric, feature, variant, value));
        }
    }

    public boolean isEmpty() {
        synchronized (lock) {
            return measures.isEmpty() && counters.isEmpty() && observations.isEmpty();
        }
    }

    public MetricStatPayload buildAndReset() {
        synchronized (lock) {
            if (measures.isEmpty() && counters.isEmpty() && observations.isEmpty()) {
                return null;
            }

            List<MetricStatPayload.ObservationMessage> observationMessages = new ArrayList<>();
            Map<String, MetricStatPayload.ObservationMessage> groups = new LinkedHashMap<>();
            for (Observation obs : observations) {
                String groupKey = obs.time.toString() + '\0' + obs.metric + '\0'
                        + (obs.feature != null ? obs.feature : "");
                MetricStatPayload.ObservationMessage group = groups.get(groupKey);
                if (group == null || group.getVariantValues().containsKey(obs.variant)) {
                    Map<String, Double> values = new LinkedHashMap<>();
                    group = new MetricStatPayload.ObservationMessage(
                            obs.time, obs.metric, obs.feature, values);
                    groups.put(groupKey, group);
                    observationMessages.add(group);
                }
                group.getVariantValues().put(obs.variant, obs.value);
            }
            observations = new ArrayList<>();

            MetricStatPayload payload = new MetricStatPayload(
                    appKey,
                    environment,
                    Instant.now(),
                    drainMap(measures),
                    drainMap(counters),
                    observationMessages,
                    instanceName);

            measures = new HashMap<>();
            counters = new HashMap<>();
            return payload;
        }
    }

    private static void addToMap(
            Map<String, Map<String, Double>> store,
            String metric,
            double value,
            MetricsFeatureOptions options) {
        String variant = resolveVariant(options);
        String mapKey = key(metric, options != null ? options.getFeature() : null);
        Map<String, Double> variants = store.computeIfAbsent(mapKey, k -> new HashMap<>());
        variants.merge(variant, value, Double::sum);
    }

    private static String resolveVariant(MetricsFeatureOptions options) {
        if (options == null || options.getVariant() == null || options.getVariant().isEmpty()) {
            return "enabled";
        }
        return options.getVariant();
    }

    private static String key(String metric, String feature) {
        return metric + '\0' + (feature != null ? feature : "");
    }

    private static List<MetricStatPayload.MetricValues> drainMap(
            Map<String, Map<String, Double>> store) {
        List<MetricStatPayload.MetricValues> out = new ArrayList<>();
        for (Map.Entry<String, Map<String, Double>> entry : store.entrySet()) {
            String[] parts = entry.getKey().split("\0", 2);
            String metric = parts[0];
            String feature = parts.length > 1 && !parts[1].isEmpty() ? parts[1] : null;
            Map<String, Double> variantValues = new LinkedHashMap<>();
            for (Map.Entry<String, Double> v : entry.getValue().entrySet()) {
                if (v.getValue() != 0.0) {
                    variantValues.put(v.getKey(), v.getValue());
                }
            }
            if (!variantValues.isEmpty()) {
                out.add(new MetricStatPayload.MetricValues(metric, feature, variantValues));
            }
        }
        store.clear();
        return out;
    }

    private static final class Observation {
        final Instant time;
        final String metric;
        final String feature;
        final String variant;
        final double value;

        Observation(Instant time, String metric, String feature, String variant, double value) {
            this.time = time;
            this.metric = metric;
            this.feature = feature;
            this.variant = variant;
            this.value = value;
        }
    }
}
