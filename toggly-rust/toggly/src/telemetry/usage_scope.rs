//! Feature usage scope: one used attempt with optional duration and failure metrics.

use crate::telemetry::usage_batcher::UsageBatcher;
use std::cell::Cell;
use std::sync::Arc;
use std::time::Instant;

/// Handle passed into [`crate::TogglyClient::use_feature`] for explicit soft failure.
pub struct FeatureUsageScope {
    batcher: Option<Arc<UsageBatcher>>,
    feature: String,
    variant: String,
    started: Instant,
    failed: Cell<bool>,
    completed: Cell<bool>,
}

impl FeatureUsageScope {
    /// No-op scope when usage telemetry is disabled.
    pub(crate) fn noop() -> Self {
        Self {
            batcher: None,
            feature: String::new(),
            variant: String::new(),
            started: Instant::now(),
            failed: Cell::new(false),
            completed: Cell::new(true),
        }
    }

    pub(crate) fn begin(
        batcher: Arc<UsageBatcher>,
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
        let Some(batcher) = self.batcher.as_ref() else {
            return;
        };
        let duration_ms = self.started.elapsed().as_millis() as i64;
        batcher.record_usage_scope_success(&self.feature, &self.variant, duration_ms);
    }

    pub(crate) fn complete_failure(&self) {
        if self.completed.replace(true) {
            return;
        }
        let Some(batcher) = self.batcher.as_ref() else {
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

impl Drop for FeatureUsageScope {
    fn drop(&mut self) {
        if self.completed.get() {
            return;
        }
        if std::thread::panicking() {
            self.complete_failure();
        } else {
            self.complete_from_outcome();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::usage_batcher::UsageBatcher;
    use std::sync::Arc;

    #[test]
    fn success_scope_records_used_and_duration() {
        let batcher = Arc::new(UsageBatcher::new("app", "Production", None, None, None));
        {
            let scope =
                FeatureUsageScope::begin(Arc::clone(&batcher), "Checkout", Some("u1"), "enabled");
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
        let batcher = Arc::new(UsageBatcher::new("app", "Production", None, None, None));
        {
            let scope = FeatureUsageScope::begin(Arc::clone(&batcher), "Checkout", None, "enabled");
            scope.fail();
            // drop completes from outcome
        }
        {
            let scope = FeatureUsageScope::begin(Arc::clone(&batcher), "Checkout", None, "enabled");
            scope.complete_failure();
        }
        let (payload, _) = batcher.build_and_reset().expect("payload");
        let enabled = payload.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.used_count, 2);
        assert_eq!(enabled.error_count, 2);
    }

    #[test]
    fn panic_drop_records_failure() {
        let batcher = Arc::new(UsageBatcher::new("app", "Production", None, None, None));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let scope = FeatureUsageScope::begin(Arc::clone(&batcher), "Checkout", None, "enabled");
            let _ = &scope;
            panic!("boom");
        }));
        assert!(result.is_err());
        let (payload, _) = batcher.build_and_reset().expect("payload");
        let enabled = payload.stats[0].variant_stats.get("enabled").unwrap();
        assert_eq!(enabled.used_count, 1);
        assert_eq!(enabled.error_count, 1);
    }
}
