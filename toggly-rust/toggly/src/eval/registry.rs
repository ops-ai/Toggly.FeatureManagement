//! Filter evaluator registry.

use crate::context::EvalContext;
use crate::definitions::FeatureFilter;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

/// Trait for filter evaluators.
pub trait Evaluator: Send + Sync {
    /// Evaluate the filter with the given parameters and context.
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool>;
}

/// Registry for filter evaluators.
#[derive(Default)]
pub struct Registry {
    evaluators: Arc<RwLock<HashMap<String, Arc<dyn Evaluator>>>>,
}

impl Registry {
    /// Create a new registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a registry with default evaluators.
    pub fn with_defaults() -> Self {
        let registry = Self::new();
        registry.register_defaults();
        registry
    }

    /// Register default evaluators.
    pub fn register_defaults(&self) {
        use super::filters::*;

        let always_on: Arc<dyn Evaluator> = Arc::new(AlwaysOnEvaluator);
        let always_off: Arc<dyn Evaluator> = Arc::new(AlwaysOffEvaluator);
        let percentage: Arc<dyn Evaluator> = Arc::new(PercentageEvaluator);
        let targeting: Arc<dyn Evaluator> = Arc::new(TargetingEvaluator);
        let time_window: Arc<dyn Evaluator> = Arc::new(TimeWindowEvaluator);
        let contextual: Arc<dyn Evaluator> = Arc::new(ContextualTargetingEvaluator);
        let context_property: Arc<dyn Evaluator> = Arc::new(ContextPropertyEvaluator);
        let browser_family: Arc<dyn Evaluator> = Arc::new(BrowserFamilyEvaluator);
        let browser_language: Arc<dyn Evaluator> = Arc::new(BrowserLanguageEvaluator);
        let country: Arc<dyn Evaluator> = Arc::new(CountryEvaluator);
        let device_type: Arc<dyn Evaluator> = Arc::new(DeviceTypeEvaluator);
        let operating_system: Arc<dyn Evaluator> = Arc::new(OperatingSystemEvaluator);
        let user_claims: Arc<dyn Evaluator> = Arc::new(UserClaimsEvaluator);

        self.register("AlwaysOn", Arc::clone(&always_on));
        self.register("On", Arc::clone(&always_on));
        self.register("AlwaysOff", Arc::clone(&always_off));
        self.register("Off", Arc::clone(&always_off));
        self.register("Percentage", Arc::clone(&percentage));
        self.register("Microsoft.Percentage", Arc::clone(&percentage));
        self.register("Targeting", Arc::clone(&targeting));
        self.register("Microsoft.Targeting", Arc::clone(&targeting));
        self.register("TimeWindow", Arc::clone(&time_window));
        self.register("Microsoft.TimeWindow", Arc::clone(&time_window));
        self.register("ContextualTargeting", contextual);
        self.register("ContextProperty", context_property);
        self.register("BrowserFamily", browser_family);
        self.register("BrowserLanguage", browser_language);
        self.register("Country", Arc::clone(&country));
        self.register("CountryFamily", country);
        self.register("DeviceType", device_type);
        self.register("OS", Arc::clone(&operating_system));
        self.register("OperatingSystem", operating_system);
        self.register("UserClaims", user_claims);
    }

    /// Register a filter evaluator.
    pub fn register(&self, name: &str, evaluator: Arc<dyn Evaluator>) {
        self.evaluators.write().insert(name.to_string(), evaluator);
    }

    /// Get a filter evaluator by name.
    pub fn get(&self, name: &str) -> Option<Arc<dyn Evaluator>> {
        self.evaluators.read().get(name).cloned()
    }

    /// Check if an evaluator exists.
    pub fn contains(&self, name: &str) -> bool {
        self.evaluators.read().contains_key(name)
    }

    /// Remove an evaluator.
    pub fn remove(&self, name: &str) -> Option<Arc<dyn Evaluator>> {
        self.evaluators.write().remove(name)
    }

    /// List all registered evaluator names.
    pub fn names(&self) -> Vec<String> {
        self.evaluators.read().keys().cloned().collect()
    }
}

impl std::fmt::Debug for Registry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Registry")
            .field("evaluators", &self.names())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestEvaluator(bool);

    impl Evaluator for TestEvaluator {
        fn evaluate(
            &self,
            _feature_key: &str,
            _filter: &FeatureFilter,
            _context: &EvalContext,
        ) -> crate::Result<bool> {
            Ok(self.0)
        }
    }

    #[test]
    fn test_registry_basic() {
        let registry = Registry::new();
        registry.register("Test", Arc::new(TestEvaluator(true)));

        assert!(registry.contains("Test"));
        assert!(!registry.contains("Unknown"));
    }

    #[test]
    fn test_registry_with_defaults() {
        let registry = Registry::with_defaults();

        assert!(registry.contains("AlwaysOn"));
        assert!(registry.contains("AlwaysOff"));
        assert!(registry.contains("Percentage"));
        assert!(registry.contains("Microsoft.Percentage"));
        assert!(registry.contains("Targeting"));
        assert!(registry.contains("Microsoft.Targeting"));
        assert!(registry.contains("TimeWindow"));
        assert!(registry.contains("Microsoft.TimeWindow"));
        assert!(registry.contains("BrowserFamily"));
        assert!(registry.contains("BrowserLanguage"));
        assert!(registry.contains("Country"));
        assert!(registry.contains("CountryFamily"));
        assert!(registry.contains("DeviceType"));
        assert!(registry.contains("OS"));
        assert!(registry.contains("OperatingSystem"));
        assert!(registry.contains("UserClaims"));
    }

    #[test]
    fn test_registry_remove() {
        let registry = Registry::new();
        registry.register("Test", Arc::new(TestEvaluator(true)));

        assert!(registry.remove("Test").is_some());
        assert!(!registry.contains("Test"));
    }
}
