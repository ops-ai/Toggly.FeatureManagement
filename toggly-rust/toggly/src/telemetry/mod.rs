//! Batched Usage.SendStats and Metrics.SendMetrics telemetry.
//!
//! Enable the optional Cargo feature `telemetry` to pull tonic/prost and send
//! over gRPC. The existing `metrics` feature (Prometheus) stays distinct.
//!
//! Soft-fail: transport errors are logged and never propagated to feature
//! evaluation. On failed usage/metrics sends, drained payloads are restored
//! into the in-memory batchers (unique maps + counters).

mod hash;
mod metrics_batcher;
mod runtime;
mod transport;
mod usage_batcher;

#[cfg(feature = "telemetry")]
pub(crate) mod pb {
    //! Generated protobuf + tonic clients (feature `telemetry` only).
    #![allow(missing_docs)]

    /// Usage.SendStats protobuf types and client.
    pub mod usage {
        #![allow(missing_docs, deprecated)]
        tonic::include_proto!("usage");
    }

    /// Metrics.SendMetrics protobuf types and client.
    pub mod metrics {
        #![allow(missing_docs, deprecated)]
        tonic::include_proto!("metrics");
    }
}

pub use hash::{
    grpc_target, hash_identity, now_protobuf_timestamp, resolve_user_agent,
    to_protobuf_timestamp_millis, DEFAULT_METRICS_BASE_URL, DEFAULT_TELEMETRY_FLUSH_SECS,
};
pub use metrics_batcher::{
    MetricObservationPayload, MetricStatPayload, MetricValueMessage, MetricsBatcher,
    MetricsFeatureOptions, MetricsSnapshot,
};
pub use runtime::{TelemetryRuntime, TelemetryRuntimeConfig};
pub use transport::{MetricsSender, TelemetrySenders, UsageSender};
pub use usage_batcher::{
    FeatureStatPayload, StatMessagePayload, UsageBatcher, UsageSnapshot, VariantStatsAgg,
    VariantStatsWire,
};

#[cfg(feature = "telemetry")]
pub use transport::NativeGrpcSenders;
