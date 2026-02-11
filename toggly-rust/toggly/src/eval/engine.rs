//! Feature evaluation engine.

use crate::context::EvalContext;
use crate::definitions::{FeatureDefinition, RequirementType};
use crate::eval::registry::Registry;
use std::sync::Arc;

/// Feature evaluation engine.
pub struct Engine {
    registry: Arc<Registry>,
}

impl Engine {
    /// Create a new engine with the given registry.
    pub fn new(registry: Arc<Registry>) -> Self {
        Self { registry }
    }

    /// Create a new engine with default evaluators.
    pub fn with_defaults() -> Self {
        Self {
            registry: Arc::new(Registry::with_defaults()),
        }
    }

    /// Get the registry.
    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    /// Evaluate a feature definition.
    pub fn evaluate(
        &self,
        definition: &FeatureDefinition,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let filters = &definition.filters;

        // No filters means feature is disabled
        if filters.is_empty() {
            return Ok(false);
        }

        let requirement = definition.requirement_type;

        match requirement {
            RequirementType::All => {
                // All filters must pass
                for filter in filters {
                    let evaluator = match self.registry.get(&filter.name) {
                        Some(e) => e,
                        None => {
                            // Missing evaluator - treat as false for All requirement
                            tracing::warn!(
                                filter = %filter.name,
                                feature = %definition.feature_key,
                                "Missing filter evaluator, treating as false"
                            );
                            return Ok(false);
                        }
                    };

                    match evaluator.evaluate(&definition.feature_key, filter, context) {
                        Ok(true) => continue,
                        Ok(false) => return Ok(false),
                        Err(e) => {
                            tracing::warn!(
                                filter = %filter.name,
                                feature = %definition.feature_key,
                                error = %e,
                                "Filter evaluation error, treating as false"
                            );
                            return Ok(false);
                        }
                    }
                }
                Ok(true)
            }
            RequirementType::Any => {
                // At least one filter must pass
                for filter in filters {
                    let evaluator = match self.registry.get(&filter.name) {
                        Some(e) => e,
                        None => {
                            // Missing evaluator - skip for Any requirement
                            tracing::debug!(
                                filter = %filter.name,
                                feature = %definition.feature_key,
                                "Missing filter evaluator, skipping"
                            );
                            continue;
                        }
                    };

                    match evaluator.evaluate(&definition.feature_key, filter, context) {
                        Ok(true) => return Ok(true),
                        Ok(false) => continue,
                        Err(e) => {
                            tracing::debug!(
                                filter = %filter.name,
                                feature = %definition.feature_key,
                                error = %e,
                                "Filter evaluation error, skipping"
                            );
                            continue;
                        }
                    }
                }
                Ok(false)
            }
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::with_defaults()
    }
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine")
            .field("registry", &self.registry)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::definitions::FeatureFilter;

    fn make_definition(key: &str, filters: Vec<(&str, serde_json::Value)>, req: RequirementType) -> FeatureDefinition {
        FeatureDefinition {
            feature_key: key.to_string(),
            filters: filters
                .into_iter()
                .map(|(name, params)| FeatureFilter {
                    name: name.to_string(),
                    parameters: params
                        .as_object()
                        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                        .unwrap_or_default(),
                })
                .collect(),
            metrics: vec![],
            secured_feature: false,
            client_sdk_enabled: true,
            requirement_type: req,
        }
    }

    #[test]
    fn test_engine_no_filters() {
        let engine = Engine::with_defaults();
        let def = make_definition("test", vec![], RequirementType::Any);

        let result = engine.evaluate(&def, &EvalContext::default()).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_engine_always_on() {
        let engine = Engine::with_defaults();
        let def = make_definition("test", vec![("AlwaysOn", serde_json::json!({}))], RequirementType::Any);

        let result = engine.evaluate(&def, &EvalContext::default()).unwrap();
        assert!(result);
    }

    #[test]
    fn test_engine_always_off() {
        let engine = Engine::with_defaults();
        let def = make_definition("test", vec![("AlwaysOff", serde_json::json!({}))], RequirementType::Any);

        let result = engine.evaluate(&def, &EvalContext::default()).unwrap();
        assert!(!result);
    }

    #[test]
    fn test_engine_requirement_all() {
        let engine = Engine::with_defaults();

        // Both must pass
        let def = make_definition(
            "test",
            vec![
                ("AlwaysOn", serde_json::json!({})),
                ("AlwaysOn", serde_json::json!({})),
            ],
            RequirementType::All,
        );
        assert!(engine.evaluate(&def, &EvalContext::default()).unwrap());

        // One fails - should fail
        let def = make_definition(
            "test",
            vec![
                ("AlwaysOn", serde_json::json!({})),
                ("AlwaysOff", serde_json::json!({})),
            ],
            RequirementType::All,
        );
        assert!(!engine.evaluate(&def, &EvalContext::default()).unwrap());
    }

    #[test]
    fn test_engine_requirement_any() {
        let engine = Engine::with_defaults();

        // At least one passes
        let def = make_definition(
            "test",
            vec![
                ("AlwaysOff", serde_json::json!({})),
                ("AlwaysOn", serde_json::json!({})),
            ],
            RequirementType::Any,
        );
        assert!(engine.evaluate(&def, &EvalContext::default()).unwrap());

        // None pass
        let def = make_definition(
            "test",
            vec![
                ("AlwaysOff", serde_json::json!({})),
                ("AlwaysOff", serde_json::json!({})),
            ],
            RequirementType::Any,
        );
        assert!(!engine.evaluate(&def, &EvalContext::default()).unwrap());
    }

    #[test]
    fn test_engine_missing_evaluator() {
        let engine = Engine::with_defaults();

        // Missing evaluator in All mode - should fail
        let def = make_definition(
            "test",
            vec![
                ("UnknownFilter", serde_json::json!({})),
            ],
            RequirementType::All,
        );
        assert!(!engine.evaluate(&def, &EvalContext::default()).unwrap());

        // Missing evaluator in Any mode - should continue to other filters
        let def = make_definition(
            "test",
            vec![
                ("UnknownFilter", serde_json::json!({})),
                ("AlwaysOn", serde_json::json!({})),
            ],
            RequirementType::Any,
        );
        assert!(engine.evaluate(&def, &EvalContext::default()).unwrap());
    }
}
