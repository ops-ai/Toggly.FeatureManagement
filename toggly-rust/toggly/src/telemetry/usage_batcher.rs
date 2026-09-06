//! In-memory feature usage aggregator (`Usage.SendStats` payload shape).

use super::hash::{hash_identity, now_protobuf_timestamp, to_protobuf_timestamp_millis};
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};

/// Per-variant counters for a feature.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VariantStatsAgg {
    /// Evaluation / check count.
    pub check_count: i32,
    /// Unique-request count (first access in a logical request).
    pub request_count: i32,
    /// Feature "used" / interaction count.
    pub used_count: i32,
    /// Feature "viewed" / rendered count.
    pub viewed_count: i32,
}

impl VariantStatsAgg {
    /// Serialize counters to the Usage wire field names.
    pub fn to_wire(&self) -> VariantStatsWire {
        VariantStatsWire {
            check_count: self.check_count,
            request_count: self.request_count,
            used_count: self.used_count,
            viewed_count: self.viewed_count,
        }
    }

    fn is_empty(&self) -> bool {
        self.check_count == 0
            && self.request_count == 0
            && self.used_count == 0
            && self.viewed_count == 0
    }
}

/// Wire shape for one variantStats entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantStatsWire {
    /// checkCount
    pub check_count: i32,
    /// requestCount
    pub request_count: i32,
    /// usedCount
    pub used_count: i32,
    /// viewedCount
    pub viewed_count: i32,
}

#[derive(Debug, Clone, Default)]
struct FeatureUsageAgg {
    variant_stats: HashMap<String, VariantStatsAgg>,
    unique_users_enabled: HashSet<i32>,
    unique_users_disabled: HashSet<i32>,
    unique_users_used: HashSet<i32>,
    unique_user_hashes: HashSet<i32>,
    unique_viewed_user_hashes: HashSet<i32>,
}

/// Per-feature row in a FeatureStat payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatMessagePayload {
    /// Feature key.
    pub feature: String,
    /// Unique enabled context identifiers.
    pub unique_context_identifier_enabled_count: i32,
    /// Unique disabled context identifiers.
    pub unique_context_identifier_disabled_count: i32,
    /// Unique users who used the feature.
    pub unique_users_used_count: i32,
    /// Unique identity hashes for used tracking.
    pub unique_user_hashes: Vec<i32>,
    /// Unique identity hashes for viewed tracking.
    pub unique_viewed_user_hashes: Vec<i32>,
    /// Multi-variant stats map (preferred over legacy scalars).
    pub variant_stats: HashMap<String, VariantStatsWire>,
}

/// FeatureStat-shaped payload ready for gRPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureStatPayload {
    /// Application key.
    pub app_key: String,
    /// Environment name.
    pub environment: String,
    /// Packet time (`seconds`, `nanos`).
    pub time: (i64, i32),
    /// Per-feature stats.
    pub stats: Vec<StatMessagePayload>,
    /// Application-level unique user count.
    pub total_unique_users: i32,
    /// Application-level unique user hashes.
    pub unique_user_hashes: Vec<i32>,
    /// Optional instance name.
    pub instance_name: Option<String>,
    /// Optional app version.
    pub app_version: Option<String>,
    /// Process start time (`seconds`, `nanos`).
    pub process_start_time: (i64, i32),
}

/// In-memory snapshot of usage aggregates taken before a send attempt.
#[derive(Debug, Clone)]
pub struct UsageSnapshot {
    per_feature: HashMap<String, FeatureUsageAgg>,
    app_unique: HashSet<i32>,
}

/// Accumulate feature usage and build FeatureStat payloads.
///
/// Prefer `variant_stats` over legacy scalars (matches .NET / Node / Ruby).
pub struct UsageBatcher {
    app_key: String,
    environment: String,
    instance_name: Option<String>,
    app_version: Option<String>,
    process_start_time: DateTime<Utc>,
    inner: Mutex<UsageInner>,
}

#[derive(Default)]
struct UsageInner {
    per_feature: HashMap<String, FeatureUsageAgg>,
    app_unique: HashSet<i32>,
}

impl UsageBatcher {
    /// Create an empty usage aggregator for one app/environment.
    pub fn new(
        app_key: impl Into<String>,
        environment: impl Into<String>,
        instance_name: Option<String>,
        app_version: Option<String>,
        process_start_time: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            app_key: app_key.into(),
            environment: environment.into(),
            instance_name,
            app_version,
            process_start_time: process_start_time.unwrap_or_else(Utc::now),
            inner: Mutex::new(UsageInner::default()),
        }
    }

    /// Record a feature evaluation.
    pub fn record_check(
        &self,
        feature: &str,
        enabled: bool,
        identity: Option<&str>,
        variant: Option<&str>,
        unique_request: bool,
    ) {
        let hashed = identity.filter(|s| !s.is_empty()).map(hash_identity);
        let name = variant
            .map(str::to_string)
            .unwrap_or_else(|| if enabled { "enabled" } else { "disabled" }.to_string());

        let mut guard = self.inner.lock();
        if let Some(h) = hashed {
            guard.app_unique.insert(h);
        }
        let agg = guard.per_feature.entry(feature.to_string()).or_default();
        let stats = agg.variant_stats.entry(name).or_default();
        stats.check_count += 1;
        if unique_request {
            stats.request_count += 1;
        }
        if let Some(h) = hashed {
            if enabled {
                agg.unique_users_enabled.insert(h);
            } else {
                agg.unique_users_disabled.insert(h);
            }
        }
    }

    /// Record a feature used/interaction event.
    pub fn record_usage(&self, feature: &str, identity: Option<&str>, variant: &str) {
        let hashed = identity.filter(|s| !s.is_empty()).map(hash_identity);
        let mut guard = self.inner.lock();
        if let Some(h) = hashed {
            guard.app_unique.insert(h);
        }
        let agg = guard.per_feature.entry(feature.to_string()).or_default();
        agg.variant_stats
            .entry(variant.to_string())
            .or_default()
            .used_count += 1;
        if let Some(h) = hashed {
            agg.unique_users_used.insert(h);
            agg.unique_user_hashes.insert(h);
        }
    }

    /// Record a feature viewed/rendered event.
    pub fn record_view(&self, feature: &str, identity: Option<&str>, variant: &str) {
        let hashed = identity.filter(|s| !s.is_empty()).map(hash_identity);
        let mut guard = self.inner.lock();
        if let Some(h) = hashed {
            guard.app_unique.insert(h);
        }
        let agg = guard.per_feature.entry(feature.to_string()).or_default();
        agg.variant_stats
            .entry(variant.to_string())
            .or_default()
            .viewed_count += 1;
        if let Some(h) = hashed {
            agg.unique_viewed_user_hashes.insert(h);
        }
    }

    /// True when no usage samples are buffered.
    pub fn is_empty(&self) -> bool {
        let guard = self.inner.lock();
        guard.per_feature.is_empty() && guard.app_unique.is_empty()
    }

    /// Build a FeatureStat-shaped payload and clear aggregates.
    ///
    /// Returns `(payload, snapshot)` so callers can restore unique maps on send failure.
    pub fn build_and_reset(&self) -> Option<(FeatureStatPayload, UsageSnapshot)> {
        let mut guard = self.inner.lock();
        if guard.per_feature.is_empty() && guard.app_unique.is_empty() {
            return None;
        }

        let snapshot = UsageSnapshot {
            per_feature: guard.per_feature.clone(),
            app_unique: guard.app_unique.clone(),
        };

        let mut stats_out = Vec::with_capacity(guard.per_feature.len());
        for (feature, agg) in guard.per_feature.drain() {
            let mut variant_stats = HashMap::new();
            for (name, vs) in agg.variant_stats {
                if !vs.is_empty() {
                    variant_stats.insert(name, vs.to_wire());
                }
            }
            stats_out.push(StatMessagePayload {
                feature,
                unique_context_identifier_enabled_count: agg.unique_users_enabled.len() as i32,
                unique_context_identifier_disabled_count: agg.unique_users_disabled.len() as i32,
                unique_users_used_count: agg.unique_users_used.len() as i32,
                unique_user_hashes: agg.unique_user_hashes.into_iter().collect(),
                unique_viewed_user_hashes: agg.unique_viewed_user_hashes.into_iter().collect(),
                variant_stats,
            });
        }

        let unique_user_hashes: Vec<i32> = guard.app_unique.drain().collect();
        let total_unique_users = unique_user_hashes.len() as i32;
        let process_start_time =
            to_protobuf_timestamp_millis(self.process_start_time.timestamp_millis());

        Some((
            FeatureStatPayload {
                app_key: self.app_key.clone(),
                environment: self.environment.clone(),
                time: now_protobuf_timestamp(),
                stats: stats_out,
                total_unique_users,
                unique_user_hashes,
                instance_name: self.instance_name.clone(),
                app_version: self.app_version.clone(),
                process_start_time,
            },
            snapshot,
        ))
    }

    /// Merge a previously drained snapshot back into the batcher after a failed send.
    ///
    /// Matches the .NET lesson: restore unique maps (and counters) so they are not lost.
    pub fn restore_snapshot(&self, snapshot: UsageSnapshot) {
        let mut guard = self.inner.lock();
        for hash in snapshot.app_unique {
            guard.app_unique.insert(hash);
        }
        for (feature, snap_agg) in snapshot.per_feature {
            let agg = guard.per_feature.entry(feature).or_default();
            for (name, vs) in snap_agg.variant_stats {
                let dest = agg.variant_stats.entry(name).or_default();
                dest.check_count = dest.check_count.saturating_add(vs.check_count);
                dest.request_count = dest.request_count.saturating_add(vs.request_count);
                dest.used_count = dest.used_count.saturating_add(vs.used_count);
                dest.viewed_count = dest.viewed_count.saturating_add(vs.viewed_count);
            }
            agg.unique_users_enabled
                .extend(snap_agg.unique_users_enabled);
            agg.unique_users_disabled
                .extend(snap_agg.unique_users_disabled);
            agg.unique_users_used.extend(snap_agg.unique_users_used);
            agg.unique_user_hashes.extend(snap_agg.unique_user_hashes);
            agg.unique_viewed_user_hashes
                .extend(snap_agg.unique_viewed_user_hashes);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_checks_into_variant_stats() {
        let batcher = UsageBatcher::new(
            "app",
            "Production",
            Some("host-1".into()),
            Some("1.2.3".into()),
            None,
        );
        batcher.record_check("FeatureA", true, Some("user-1"), None, false);
        batcher.record_check("FeatureA", true, Some("user-1"), None, false);
        batcher.record_check("FeatureA", false, Some("user-2"), None, false);
        batcher.record_usage("FeatureA", Some("user-1"), "enabled");
        batcher.record_view("FeatureA", Some("user-3"), "enabled");

        let (payload, _) = batcher.build_and_reset().expect("payload");
        assert_eq!(payload.app_key, "app");
        assert_eq!(payload.environment, "Production");
        assert_eq!(payload.instance_name.as_deref(), Some("host-1"));
        assert_eq!(payload.app_version.as_deref(), Some("1.2.3"));
        assert_eq!(payload.stats.len(), 1);

        let stat = &payload.stats[0];
        assert_eq!(stat.feature, "FeatureA");
        let enabled = stat.variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.check_count, 2);
        assert_eq!(enabled.used_count, 1);
        assert_eq!(enabled.viewed_count, 1);
        let disabled = stat.variant_stats.get("disabled").unwrap();
        assert_eq!(disabled.check_count, 1);
        assert_eq!(stat.unique_context_identifier_enabled_count, 1);
        assert_eq!(stat.unique_context_identifier_disabled_count, 1);
        assert_eq!(stat.unique_users_used_count, 1);
        assert!(stat.unique_user_hashes.contains(&hash_identity("user-1")));
        assert!(stat
            .unique_viewed_user_hashes
            .contains(&hash_identity("user-3")));

        let mut app_hashes = payload.unique_user_hashes.clone();
        app_hashes.sort_unstable();
        let mut expected = vec![
            hash_identity("user-1"),
            hash_identity("user-2"),
            hash_identity("user-3"),
        ];
        expected.sort_unstable();
        assert_eq!(app_hashes, expected);
        assert!(batcher.build_and_reset().is_none());
    }

    #[test]
    fn restore_merges_unique_hashes_after_failed_send() {
        let batcher = UsageBatcher::new("app", "Production", None, None, None);
        batcher.record_check("FeatureA", true, Some("user-1"), None, false);
        batcher.record_usage("FeatureA", Some("user-1"), "enabled");
        let (_, snapshot) = batcher.build_and_reset().expect("payload");
        assert!(batcher.is_empty());

        batcher.restore_snapshot(snapshot);
        assert!(!batcher.is_empty());

        batcher.record_check("FeatureA", true, Some("user-2"), None, false);
        let (again, _) = batcher.build_and_reset().expect("merged");
        let mut hashes = again.unique_user_hashes.clone();
        hashes.sort_unstable();
        let mut expected = vec![hash_identity("user-1"), hash_identity("user-2")];
        expected.sort_unstable();
        assert_eq!(hashes, expected);
        let enabled = again.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.check_count, 2);
        assert_eq!(enabled.used_count, 1);
        assert_eq!(again.stats[0].unique_context_identifier_enabled_count, 2);
    }

    #[test]
    fn request_count_only_when_unique_request() {
        let batcher = UsageBatcher::new("app", "Production", None, None, None);
        batcher.record_check("FeatureA", true, Some("user-1"), None, true);
        batcher.record_check("FeatureA", true, Some("user-1"), None, false);
        let (payload, _) = batcher.build_and_reset().unwrap();
        let enabled = payload.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.check_count, 2);
        assert_eq!(enabled.request_count, 1);
    }
}
