//! In-memory business metrics aggregator (`Metrics.SendMetrics` payload shape).

use super::hash::{now_protobuf_timestamp, to_protobuf_timestamp_millis};
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use std::collections::hash_map::Entry;
use std::collections::HashMap;

/// Optional feature/variant correlation for a metric sample.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MetricsFeatureOptions {
    /// Feature key for experiment correlation.
    pub feature: Option<String>,
    /// Variant name (defaults to `"enabled"`).
    pub variant: Option<String>,
}

impl MetricsFeatureOptions {
    /// Create options with a feature and optional variant.
    pub fn new(feature: impl Into<String>, variant: Option<impl Into<String>>) -> Self {
        Self {
            feature: Some(feature.into()),
            variant: variant.map(Into::into),
        }
    }
}

/// One measure/counter row on the wire.
#[derive(Debug, Clone, PartialEq)]
pub struct MetricValueMessage {
    /// Metric name.
    pub metric: String,
    /// Optional correlated feature.
    pub feature: Option<String>,
    /// Multi-variant values map (preferred over legacy scalars).
    pub variant_values: HashMap<String, f64>,
}

/// One observation group on the wire.
#[derive(Debug, Clone, PartialEq)]
pub struct MetricObservationPayload {
    /// Observation time (`seconds`, `nanos`).
    pub time: (i64, i32),
    /// Metric name.
    pub metric: String,
    /// Optional correlated feature.
    pub feature: Option<String>,
    /// Multi-variant values.
    pub variant_values: HashMap<String, f64>,
}

/// MetricStat-shaped payload ready for gRPC.
#[derive(Debug, Clone, PartialEq)]
pub struct MetricStatPayload {
    /// Application key.
    pub app_key: String,
    /// Environment name.
    pub environment: String,
    /// Packet time.
    pub time: (i64, i32),
    /// Aggregated measures.
    pub stats: Vec<MetricValueMessage>,
    /// Aggregated counters.
    pub counters: Vec<MetricValueMessage>,
    /// Point-in-time observations.
    pub observations: Vec<MetricObservationPayload>,
    /// Optional instance name.
    pub instance_name: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingObservation {
    time: DateTime<Utc>,
    metric: String,
    feature: Option<String>,
    variant: String,
    value: f64,
}

/// Accumulate business metrics and build MetricStat payloads.
pub struct MetricsBatcher {
    app_key: String,
    environment: String,
    instance_name: Option<String>,
    inner: Mutex<MetricsInner>,
}

#[derive(Default)]
struct MetricsInner {
    /// Keyed by (metric, feature) → variant → value.
    measures: HashMap<(String, String), HashMap<String, f64>>,
    counters: HashMap<(String, String), HashMap<String, f64>>,
    observations: Vec<PendingObservation>,
}

impl MetricsBatcher {
    /// Create an empty metrics aggregator.
    pub fn new(
        app_key: impl Into<String>,
        environment: impl Into<String>,
        instance_name: Option<String>,
    ) -> Self {
        Self {
            app_key: app_key.into(),
            environment: environment.into(),
            instance_name,
            inner: Mutex::new(MetricsInner::default()),
        }
    }

    /// Aggregate a measurement (sum over the flush window).
    pub fn measure(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        let mut guard = self.inner.lock();
        add_to_map(&mut guard.measures, metric, value, options);
    }

    /// Increment a counter.
    pub fn increment_counter(
        &self,
        metric: &str,
        value: f64,
        options: Option<&MetricsFeatureOptions>,
    ) {
        let mut guard = self.inner.lock();
        add_to_map(&mut guard.counters, metric, value, options);
    }

    /// Record a point-in-time observation (gauge).
    pub fn observe(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        let (feature, variant) = normalize_options(options);
        let mut guard = self.inner.lock();
        guard.observations.push(PendingObservation {
            time: Utc::now(),
            metric: metric.to_string(),
            feature,
            variant,
            value,
        });
    }

    /// True when no metric samples are buffered.
    pub fn is_empty(&self) -> bool {
        let guard = self.inner.lock();
        guard.measures.is_empty() && guard.counters.is_empty() && guard.observations.is_empty()
    }

    /// Build a MetricStat-shaped payload and clear aggregates.
    ///
    /// Returns `(payload, snapshot)` for restore-on-failure.
    pub fn build_and_reset(&self) -> Option<(MetricStatPayload, MetricsSnapshot)> {
        let mut guard = self.inner.lock();
        if guard.measures.is_empty() && guard.counters.is_empty() && guard.observations.is_empty() {
            return None;
        }

        let snapshot = MetricsSnapshot {
            measures: guard.measures.clone(),
            counters: guard.counters.clone(),
            observations: guard.observations.clone(),
        };

        let stats = drain_map(&mut guard.measures);
        let counters = drain_map(&mut guard.counters);
        let observations = drain_observations(&mut guard.observations);

        Some((
            MetricStatPayload {
                app_key: self.app_key.clone(),
                environment: self.environment.clone(),
                time: now_protobuf_timestamp(),
                stats,
                counters,
                observations,
                instance_name: self.instance_name.clone(),
            },
            snapshot,
        ))
    }

    /// Merge a previously drained snapshot back after a failed send.
    pub fn restore_snapshot(&self, snapshot: MetricsSnapshot) {
        let mut guard = self.inner.lock();
        for (key, variants) in snapshot.measures {
            let entry = guard.measures.entry(key).or_default();
            for (variant, value) in variants {
                *entry.entry(variant).or_insert(0.0) += value;
            }
        }
        for (key, variants) in snapshot.counters {
            let entry = guard.counters.entry(key).or_default();
            for (variant, value) in variants {
                *entry.entry(variant).or_insert(0.0) += value;
            }
        }
        guard.observations.extend(snapshot.observations);
    }
}

/// In-memory snapshot of metrics aggregates taken before a send attempt.
#[derive(Debug, Clone)]
pub struct MetricsSnapshot {
    measures: HashMap<(String, String), HashMap<String, f64>>,
    counters: HashMap<(String, String), HashMap<String, f64>>,
    observations: Vec<PendingObservation>,
}

fn normalize_options(options: Option<&MetricsFeatureOptions>) -> (Option<String>, String) {
    match options {
        Some(opts) => {
            let variant = opts
                .variant
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("enabled")
                .to_string();
            let feature = opts.feature.as_ref().filter(|s| !s.is_empty()).cloned();
            (feature, variant)
        }
        None => (None, "enabled".to_string()),
    }
}

fn add_to_map(
    store: &mut HashMap<(String, String), HashMap<String, f64>>,
    metric: &str,
    value: f64,
    options: Option<&MetricsFeatureOptions>,
) {
    let (feature, variant) = normalize_options(options);
    let feature_key = feature.unwrap_or_default();
    let entry = store.entry((metric.to_string(), feature_key)).or_default();
    *entry.entry(variant).or_insert(0.0) += value;
}

fn drain_map(
    store: &mut HashMap<(String, String), HashMap<String, f64>>,
) -> Vec<MetricValueMessage> {
    let mut out = Vec::new();
    for ((metric, feature), variants) in store.drain() {
        let variant_values: HashMap<String, f64> =
            variants.into_iter().filter(|(_, v)| *v != 0.0).collect();
        if variant_values.is_empty() {
            continue;
        }
        out.push(MetricValueMessage {
            metric,
            feature: if feature.is_empty() {
                None
            } else {
                Some(feature)
            },
            variant_values,
        });
    }
    out
}

fn drain_observations(pending: &mut Vec<PendingObservation>) -> Vec<MetricObservationPayload> {
    let mut observation_messages: Vec<MetricObservationPayload> = Vec::new();
    let mut groups: HashMap<String, usize> = HashMap::new();

    for obs in pending.drain(..) {
        let feature_key = obs.feature.clone().unwrap_or_default();
        let group_key = format!(
            "{}\0{}\0{}",
            obs.time.timestamp_millis(),
            obs.metric,
            feature_key
        );
        if let Some(&idx) = groups.get(&group_key) {
            let conflict = match observation_messages[idx].variant_values.entry(obs.variant) {
                Entry::Vacant(e) => {
                    e.insert(obs.value);
                    None
                }
                Entry::Occupied(e) => {
                    // Same variant already present — start a new group (matches Ruby).
                    Some(e.key().clone())
                }
            };
            if let Some(variant) = conflict {
                let mut variant_values = HashMap::new();
                variant_values.insert(variant, obs.value);
                let new_idx = observation_messages.len();
                observation_messages.push(MetricObservationPayload {
                    time: to_protobuf_timestamp_millis(obs.time.timestamp_millis()),
                    metric: obs.metric.clone(),
                    feature: obs.feature.clone(),
                    variant_values,
                });
                groups.insert(group_key, new_idx);
            }
        } else {
            let mut variant_values = HashMap::new();
            variant_values.insert(obs.variant.clone(), obs.value);
            let idx = observation_messages.len();
            observation_messages.push(MetricObservationPayload {
                time: to_protobuf_timestamp_millis(obs.time.timestamp_millis()),
                metric: obs.metric.clone(),
                feature: obs.feature.clone(),
                variant_values,
            });
            groups.insert(group_key, idx);
        }
    }
    observation_messages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measure_and_counter_use_variant_values() {
        let batcher = MetricsBatcher::new("app", "Production", Some("host-1".into()));
        let opts = MetricsFeatureOptions::new("FeatureA", Some("control"));
        batcher.measure("latency", 1.5, Some(&opts));
        batcher.measure("latency", 2.5, Some(&opts));
        batcher.increment_counter("clicks", 1.0, None);
        batcher.increment_counter("clicks", 2.0, None);

        let payload = batcher.build_and_reset().expect("payload");
        assert_eq!(payload.0.app_key, "app");
        assert_eq!(payload.0.instance_name.as_deref(), Some("host-1"));

        let measure = payload
            .0
            .stats
            .iter()
            .find(|s| s.metric == "latency")
            .unwrap();
        assert_eq!(measure.feature.as_deref(), Some("FeatureA"));
        assert_eq!(measure.variant_values.get("control"), Some(&4.0));

        let counter = payload
            .0
            .counters
            .iter()
            .find(|c| c.metric == "clicks")
            .unwrap();
        assert!(counter.feature.is_none());
        assert_eq!(counter.variant_values.get("enabled"), Some(&3.0));
        assert!(batcher.is_empty());
    }

    #[test]
    fn restore_merges_measures_after_failed_send() {
        let batcher = MetricsBatcher::new("app", "Production", None);
        batcher.measure("m", 1.0, None);
        let (_, snapshot) = batcher.build_and_reset().unwrap();
        batcher.restore_snapshot(snapshot);
        batcher.measure("m", 2.0, None);
        let (again, _) = batcher.build_and_reset().unwrap();
        assert_eq!(again.stats[0].variant_values.get("enabled"), Some(&3.0));
    }

    #[test]
    fn observations_spill_duplicate_variants_into_new_group() {
        let t = Utc::now();
        let mut pending = vec![
            PendingObservation {
                time: t,
                metric: "gauge".into(),
                feature: Some("FeatureA".into()),
                variant: "control".into(),
                value: 1.0,
            },
            PendingObservation {
                time: t,
                metric: "gauge".into(),
                feature: Some("FeatureA".into()),
                variant: "control".into(),
                value: 2.0,
            },
            PendingObservation {
                time: t,
                metric: "gauge".into(),
                feature: Some("FeatureA".into()),
                variant: "treatment".into(),
                value: 3.0,
            },
        ];
        let out = drain_observations(&mut pending);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].variant_values.get("control"), Some(&1.0));
        // Active group after spillover receives the new variant (Ruby parity).
        assert_eq!(out[1].variant_values.get("control"), Some(&2.0));
        assert_eq!(out[1].variant_values.get("treatment"), Some(&3.0));
    }

    #[test]
    fn observe_emits_observation_payload() {
        let batcher = MetricsBatcher::new("app", "Production", None);
        batcher.observe(
            "gauge",
            9.5,
            Some(&MetricsFeatureOptions::new("FeatureA", Some("v1"))),
        );
        let (payload, _) = batcher.build_and_reset().expect("payload");
        assert_eq!(payload.observations.len(), 1);
        assert_eq!(payload.observations[0].metric, "gauge");
        assert_eq!(payload.observations[0].variant_values.get("v1"), Some(&9.5));
    }

    #[test]
    fn empty_batcher_build_returns_none() {
        let batcher = MetricsBatcher::new("app", "Production", None);
        assert!(batcher.is_empty());
        assert!(batcher.build_and_reset().is_none());
    }
}
