//! Feature usage scope: one used attempt with optional duration and failure metrics.

use super::usage_batcher::UsageBatcher;
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
