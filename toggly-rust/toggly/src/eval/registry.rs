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

        self.register("AlwaysOn", Arc::new(AlwaysOnEvaluator));
        self.register("On", Arc::new(AlwaysOnEvaluator));
        self.register("AlwaysOff", Arc::new(AlwaysOffEvaluator));
        self.register("Off", Arc::new(AlwaysOffEvaluator));
        self.register("Percentage", Arc::new(PercentageEvaluator));
        self.register("Targeting", Arc::new(TargetingEvaluator));
        self.register("TimeWindow", Arc::new(TimeWindowEvaluator));
        self.register("ContextualTargeting", Arc::new(ContextualTargetingEvaluator));
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
        assert!(registry.contains("Targeting"));
    }

    #[test]
    fn test_registry_remove() {
        let registry = Registry::new();
        registry.register("Test", Arc::new(TestEvaluator(true)));

        assert!(registry.remove("Test").is_some());
        assert!(!registry.contains("Test"));
    }
}
