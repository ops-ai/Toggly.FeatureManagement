//! Optional send transports for usage and metrics telemetry.

use super::metrics_batcher::MetricStatPayload;
use super::usage_batcher::FeatureStatPayload;
use async_trait::async_trait;
use std::sync::Arc;

/// Sends a FeatureStat payload (Usage.SendStats).
#[async_trait]
pub trait UsageSender: Send + Sync {
    /// Send accumulated usage stats. Errors are soft-failed by the runtime.
    async fn send_stats(&self, payload: &FeatureStatPayload) -> Result<(), String>;
}

/// Sends a MetricStat payload (Metrics.SendMetrics).
#[async_trait]
pub trait MetricsSender: Send + Sync {
    /// Send accumulated business metrics. Errors are soft-failed by the runtime.
    async fn send_metrics(&self, payload: &MetricStatPayload) -> Result<(), String>;
}

/// Pair of optional usage/metrics senders.
#[derive(Clone, Default)]
pub struct TelemetrySenders {
    /// Usage.SendStats client.
    pub usage: Option<Arc<dyn UsageSender>>,
    /// Metrics.SendMetrics client.
    pub metrics: Option<Arc<dyn MetricsSender>>,
}

impl std::fmt::Debug for TelemetrySenders {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelemetrySenders")
            .field("usage", &self.usage.as_ref().map(|_| "<UsageSender>"))
            .field("metrics", &self.metrics.as_ref().map(|_| "<MetricsSender>"))
            .finish()
    }
}

#[cfg(feature = "telemetry")]
mod native {
    use super::*;
    use crate::telemetry::hash::{grpc_target, resolve_user_agent};
    use crate::telemetry::pb::metrics::metrics_client::MetricsClient;
    use crate::telemetry::pb::metrics::{
        MetricCounterMessage, MetricObservationMessage, MetricStat, MetricStatMessage,
    };
    use crate::telemetry::pb::usage::usage_client::UsageClient;
    use crate::telemetry::pb::usage::{FeatureStat, StatMessage, VariantStats};
    use tonic::metadata::MetadataValue;
    use tonic::transport::{Channel, ClientTlsConfig};
    use tonic::Request;

    /// Native tonic clients dialed against `metrics_base_url`.
    pub struct NativeGrpcSenders {
        usage: UsageClient<Channel>,
        metrics: MetricsClient<Channel>,
        user_agent: String,
    }

    impl NativeGrpcSenders {
        /// Dial TLS gRPC clients for Usage + Metrics.
        pub async fn dial(
            metrics_base_url: &str,
            user_agent: Option<&str>,
        ) -> Result<Self, String> {
            let target = grpc_target(metrics_base_url);
            let endpoint = format!("https://{target}");
            let channel = Channel::from_shared(endpoint)
                .map_err(|e| format!("invalid metrics base URL: {e}"))?
                .tls_config(ClientTlsConfig::new())
                .map_err(|e| format!("TLS config failed: {e}"))?
                .connect()
                .await
                .map_err(|e| format!("gRPC connect failed: {e}"))?;

            Ok(Self {
                usage: UsageClient::new(channel.clone()),
                metrics: MetricsClient::new(channel),
                user_agent: resolve_user_agent(user_agent),
            })
        }

        /// Split into trait objects for the runtime.
        pub fn into_senders(self) -> TelemetrySenders {
            let shared = Arc::new(self);
            TelemetrySenders {
                usage: Some(shared.clone()),
                metrics: Some(shared),
            }
        }
    }

    #[async_trait]
    impl UsageSender for NativeGrpcSenders {
        async fn send_stats(&self, payload: &FeatureStatPayload) -> Result<(), String> {
            let msg = feature_stat_from_payload(payload);
            let mut request = Request::new(msg);
            insert_ua(request.metadata_mut(), &self.user_agent)?;
            let mut client = self.usage.clone();
            client
                .send_stats(request)
                .await
                .map_err(|e| format!("Usage.SendStats failed: {e}"))?;
            Ok(())
        }
    }

    #[async_trait]
    impl MetricsSender for NativeGrpcSenders {
        async fn send_metrics(&self, payload: &MetricStatPayload) -> Result<(), String> {
            let msg = metric_stat_from_payload(payload);
            let mut request = Request::new(msg);
            insert_ua(request.metadata_mut(), &self.user_agent)?;
            let mut client = self.metrics.clone();
            client
                .send_metrics(request)
                .await
                .map_err(|e| format!("Metrics.SendMetrics failed: {e}"))?;
            Ok(())
        }
    }

    fn insert_ua(
        metadata: &mut tonic::metadata::MetadataMap,
        user_agent: &str,
    ) -> Result<(), String> {
        let value =
            MetadataValue::try_from(user_agent).map_err(|e| format!("invalid UA metadata: {e}"))?;
        // HTTP/2 metadata is case-insensitive; .NET/Go send "UA".
        metadata.insert("ua", value);
        Ok(())
    }

    fn timestamp(pair: (i64, i32)) -> prost_types::Timestamp {
        prost_types::Timestamp {
            seconds: pair.0,
            nanos: pair.1,
        }
    }

    #[allow(deprecated)]
    pub fn feature_stat_from_payload(payload: &FeatureStatPayload) -> FeatureStat {
        let mut stats = Vec::with_capacity(payload.stats.len());
        for s in &payload.stats {
            let mut variant_stats = std::collections::HashMap::new();
            for (name, vs) in &s.variant_stats {
                variant_stats.insert(
                    name.clone(),
                    VariantStats {
                        check_count: vs.check_count,
                        request_count: vs.request_count,
                        used_count: vs.used_count,
                        viewed_count: vs.viewed_count,
                    },
                );
            }
            stats.push(StatMessage {
                feature: s.feature.clone(),
                enabled_count: 0,
                disabled_count: 0,
                unique_context_identifier_enabled_count: s.unique_context_identifier_enabled_count,
                unique_context_identifier_disabled_count: s
                    .unique_context_identifier_disabled_count,
                unique_request_enabled_count: 0,
                unique_request_disabled_count: 0,
                used_count: 0,
                unique_users_used_count: s.unique_users_used_count,
                unique_user_hashes: s.unique_user_hashes.clone(),
                variant_stats,
                unique_viewed_user_hashes: s.unique_viewed_user_hashes.clone(),
            });
        }

        FeatureStat {
            app_key: payload.app_key.clone(),
            environment: payload.environment.clone(),
            time: Some(timestamp(payload.time)),
            stats,
            total_unique_users: payload.total_unique_users,
            instance_name: payload.instance_name.clone(),
            process_start_time: Some(timestamp(payload.process_start_time)),
            app_version: payload.app_version.clone(),
            unique_user_hashes: payload.unique_user_hashes.clone(),
            definition_cache_hits: payload.definition_cache_hits,
            definition_cache_misses: payload.definition_cache_misses,
        }
    }

    #[allow(deprecated)]
    pub fn metric_stat_from_payload(payload: &MetricStatPayload) -> MetricStat {
        let stats = payload
            .stats
            .iter()
            .map(|s| MetricStatMessage {
                metric: s.metric.clone(),
                enabled_count: 0,
                disabled_count: 0,
                feature: s.feature.clone(),
                value: 0.0,
                value_disabled: None,
                variant_values: s.variant_values.clone(),
            })
            .collect();
        let counters = payload
            .counters
            .iter()
            .map(|s| MetricCounterMessage {
                metric: s.metric.clone(),
                enabled_count: 0,
                disabled_count: 0,
                feature: s.feature.clone(),
                value: 0.0,
                value_disabled: None,
                variant_values: s.variant_values.clone(),
            })
            .collect();
        let observations = payload
            .observations
            .iter()
            .map(|o| MetricObservationMessage {
                time: Some(timestamp(o.time)),
                metric: o.metric.clone(),
                enabled_count: 0,
                disabled_count: 0,
                feature: o.feature.clone(),
                value: 0.0,
                value_disabled: None,
                variant_values: o.variant_values.clone(),
            })
            .collect();

        MetricStat {
            app_key: payload.app_key.clone(),
            environment: payload.environment.clone(),
            time: Some(timestamp(payload.time)),
            stats,
            counters,
            observations,
            instance_name: payload.instance_name.clone(),
        }
    }

    // end native
}

#[cfg(feature = "telemetry")]
pub use native::NativeGrpcSenders;

#[cfg(all(test, feature = "telemetry"))]
mod tests {
    use super::native::{feature_stat_from_payload, metric_stat_from_payload};
    use super::*;
    use crate::telemetry::metrics_batcher::{
        MetricObservationPayload, MetricStatPayload, MetricValueMessage,
    };
    use crate::telemetry::usage_batcher::{
        FeatureStatPayload, StatMessagePayload, VariantStatsWire,
    };
    use std::collections::HashMap;

    #[test]
    fn feature_stat_maps_variant_stats() {
        let mut variant_stats = HashMap::new();
        variant_stats.insert(
            "enabled".into(),
            VariantStatsWire {
                check_count: 2,
                request_count: 1,
                used_count: 3,
                viewed_count: 4,
            },
        );
        let payload = FeatureStatPayload {
            app_key: "app".into(),
            environment: "Production".into(),
            time: (10, 20),
            stats: vec![StatMessagePayload {
                feature: "FeatureA".into(),
                unique_context_identifier_enabled_count: 1,
                unique_context_identifier_disabled_count: 0,
                unique_users_used_count: 1,
                unique_user_hashes: vec![7],
                unique_viewed_user_hashes: vec![8],
                variant_stats,
            }],
            total_unique_users: 1,
            unique_user_hashes: vec![7],
            instance_name: Some("host".into()),
            app_version: Some("1.0".into()),
            process_start_time: (1, 2),
            definition_cache_hits: Some(2),
            definition_cache_misses: Some(1),
        };
        let msg = feature_stat_from_payload(&payload);
        assert_eq!(msg.app_key, "app");
        assert_eq!(msg.stats.len(), 1);
        assert_eq!(msg.stats[0].feature, "FeatureA");
        assert_eq!(msg.stats[0].variant_stats["enabled"].check_count, 2);
        assert_eq!(msg.time.as_ref().map(|t| t.seconds), Some(10));
        assert_eq!(msg.definition_cache_hits, Some(2));
        assert_eq!(msg.definition_cache_misses, Some(1));
    }

    #[test]
    fn metric_stat_maps_stats_counters_observations() {
        let mut values = HashMap::new();
        values.insert("enabled".into(), 1.5);
        let payload = MetricStatPayload {
            app_key: "app".into(),
            environment: "Production".into(),
            time: (11, 22),
            stats: vec![MetricValueMessage {
                metric: "latency".into(),
                feature: Some("FeatureA".into()),
                variant_values: values.clone(),
            }],
            counters: vec![MetricValueMessage {
                metric: "clicks".into(),
                feature: None,
                variant_values: values.clone(),
            }],
            observations: vec![MetricObservationPayload {
                time: (12, 0),
                metric: "gauge".into(),
                feature: None,
                variant_values: values,
            }],
            instance_name: Some("host".into()),
        };
        let msg = metric_stat_from_payload(&payload);
        assert_eq!(msg.stats.len(), 1);
        assert_eq!(msg.counters.len(), 1);
        assert_eq!(msg.observations.len(), 1);
        assert_eq!(msg.stats[0].variant_values.get("enabled"), Some(&1.5));
        assert_eq!(
            msg.observations[0].time.as_ref().map(|t| t.seconds),
            Some(12)
        );
    }

    #[tokio::test]
    async fn dial_rejects_invalid_endpoint() {
        let err = NativeGrpcSenders::dial("://not-a-url", None).await;
        assert!(err.is_err());
    }

    #[test]
    fn senders_debug_hides_trait_objects() {
        let dbg = format!("{:?}", TelemetrySenders::default());
        assert!(dbg.contains("TelemetrySenders"));
        assert!(dbg.contains("usage"));
    }
}
