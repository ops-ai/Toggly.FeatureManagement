//! Route guards for feature flags.

use actix_web::{guard::Guard, web};
use toggly::TogglyClient;

/// Route guard that checks if a feature is enabled.
///
/// Note: This guard performs synchronous checks using cached values.
/// For async checks, use the middleware or extractors.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{web, App};
/// use toggly_actix::FeatureGuard;
///
/// App::new()
///     .route("/beta", web::get()
///         .guard(FeatureGuard::new("beta-features"))
///         .to(beta_handler))
/// ```
pub struct FeatureGuard {
    feature_key: String,
    negate: bool,
}

impl FeatureGuard {
    /// Create a new feature guard.
    pub fn new(feature_key: impl Into<String>) -> Self {
        Self {
            feature_key: feature_key.into(),
            negate: false,
        }
    }

    /// Create a guard that checks if a feature is disabled.
    pub fn disabled(feature_key: impl Into<String>) -> Self {
        Self {
            feature_key: feature_key.into(),
            negate: true,
        }
    }

    /// Negate the check.
    pub fn negate(mut self) -> Self {
        self.negate = !self.negate;
        self
    }
}

impl Guard for FeatureGuard {
    fn check(&self, ctx: &actix_web::guard::GuardContext<'_>) -> bool {
        // Get client from app data
        let client = match ctx.app_data::<web::Data<TogglyClient>>() {
            Some(c) => c,
            None => {
                tracing::warn!("TogglyClient not found in app data for guard");
                return false;
            }
        };

        // Note: Guards are synchronous, so we can't do async checks here
        // We use a synchronous check based on cached definitions
        let is_defined = client.is_defined_sync(&self.feature_key);

        // If defined and we want enabled, return true
        // If not defined, return false (or true if negated)
        let result = if self.negate { !is_defined } else { is_defined };

        tracing::debug!(
            feature = %self.feature_key,
            negate = %self.negate,
            result = %result,
            "Feature guard check"
        );

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_guard_new() {
        let guard = FeatureGuard::new("my-feature");
        assert_eq!(guard.feature_key, "my-feature");
        assert!(!guard.negate);
    }

    #[test]
    fn test_feature_guard_disabled() {
        let guard = FeatureGuard::disabled("my-feature");
        assert_eq!(guard.feature_key, "my-feature");
        assert!(guard.negate);
    }

    #[test]
    fn test_feature_guard_negate() {
        let guard = FeatureGuard::new("my-feature").negate();
        assert!(guard.negate);

        let guard = guard.negate();
        assert!(!guard.negate);
    }
}
