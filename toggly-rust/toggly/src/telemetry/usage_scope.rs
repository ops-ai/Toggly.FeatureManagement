//! Feature usage scope: one used attempt with optional duration and failure metrics.

use crate::telemetry::usage_batcher::UsageBatcher;
use std::cell::Cell;
use std::time::Instant;

/// Handle passed into [`crate::TogglyClient::use_feature`] for explicit soft failure.
pub struct FeatureUsageScope<'a> {
    batcher: Option<&'a UsageBatcher>,
    feature: String,
    variant: String,
    started: Instant,
    failed: Cell<bool>,
    completed: Cell<bool>,
}

impl FeatureUsageScope<'_> {
    /// No-op scope when usage telemetry is disabled.
    pub(crate) fn noop() -> FeatureUsageScope<'static> {
        FeatureUsageScope {
            batcher: None,
            feature: String::new(),
            variant: String::new(),
            started: Instant::now(),
            failed: Cell::new(false),
            completed: Cell::new(true),
        }
    }
}

impl<'a> FeatureUsageScope<'a> {
    pub(crate) fn begin(
        batcher: &'a UsageBatcher,
        feature: &str,
        identity: Option<&str>,
        variant: &str,
    ) -> Self {
        batcher.record_usage(feature, identity, variant);
        Self {
            batcher: Some(batcher),
            feature: feature.to_string(),
            variant: variant.to_string(),
            started: Instant::now(),
            failed: Cell::new(false),
            completed: Cell::new(false),
        }
    }

    /// Marks the scope as failed without returning `Err` (soft failure).
    pub fn fail(&self) {
        self.failed.set(true);
    }

    pub(crate) fn complete_success(&self) {
        if self.completed.replace(true) {
            return;
        }
        let Some(batcher) = self.batcher else {
            return;
        };
        let duration_ms = self.started.elapsed().as_millis() as i64;
        batcher.record_usage_scope_success(&self.feature, &self.variant, duration_ms);
    }

    pub(crate) fn complete_failure(&self) {
        if self.completed.replace(true) {
            return;
        }
        let Some(batcher) = self.batcher else {
            return;
        };
        let duration_ms = self.started.elapsed().as_millis() as i64;
        batcher.record_usage_scope_failure(&self.feature, &self.variant, duration_ms);
    }

    pub(crate) fn complete_from_outcome(&self) {
        if self.failed.get() {
            self.complete_failure();
        } else {
            self.complete_success();
        }
    }
}

impl Drop for FeatureUsageScope<'_> {
    fn drop(&mut self) {
        if !self.completed.get() {
            self.complete_from_outcome();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::usage_batcher::UsageBatcher;

    #[test]
    fn success_scope_records_used_and_duration() {
        let batcher = UsageBatcher::new("app", "Production", None, None, None);
        {
            let scope = FeatureUsageScope::begin(&batcher, "Checkout", Some("u1"), "enabled");
            std::thread::sleep(std::time::Duration::from_millis(2));
            scope.complete_success();
        }
        let (payload, _) = batcher.build_and_reset().expect("payload");
        let enabled = payload.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.used_count, 1);
        assert_eq!(enabled.error_count, 0);
        assert!(enabled.duration_sum_ms >= 0);
    }

    #[test]
    fn fail_and_drop_record_errors() {
        let batcher = UsageBatcher::new("app", "Production", None, None, None);
        {
            let scope = FeatureUsageScope::begin(&batcher, "Checkout", None, "enabled");
            scope.fail();
            // drop completes from outcome
        }
        {
            let scope = FeatureUsageScope::begin(&batcher, "Checkout", None, "enabled");
            scope.complete_failure();
        }
        let (payload, _) = batcher.build_and_reset().expect("payload");
        let enabled = payload.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.used_count, 2);
        assert_eq!(enabled.error_count, 2);
    }

    #[test]
    fn noop_scope_is_safe() {
        let scope = FeatureUsageScope::noop();
        scope.fail();
        scope.complete_success();
        scope.complete_failure();
    }
}
