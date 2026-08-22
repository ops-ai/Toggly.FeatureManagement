//! Feature evaluation engine.

use crate::context::{EvalContext, TogglyEntityContext};
use crate::definitions::{FeatureDefinition, FeatureFilter, RequirementType};
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
        if filters.is_empty() {
            return Ok(false);
        }

        let (entity_filters, user_filters): (Vec<_>, Vec<_>) = filters
            .iter()
            .partition(|f| f.name.eq_ignore_ascii_case("ContextProperty"));

        if !entity_filters.is_empty() {
            let Some(entity) = &context.entity else {
                return Ok(false);
            };
            if !evaluate_entity_filters(definition, &entity_filters, entity) {
                return Ok(false);
            }
            if user_filters.is_empty() {
                return Ok(true);
            }
            return self.evaluate_group(&definition.feature_key, &user_filters, definition.requirement_type, context);
        }

        self.evaluate_group(&definition.feature_key, &user_filters, definition.requirement_type, context)
    }

    fn evaluate_group(
        &self,
        feature_key: &str,
        filters: &[&crate::definitions::FeatureFilter],
        requirement: RequirementType,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        match requirement {
            RequirementType::All => {
                for filter in filters {
                    let evaluator = match self.registry.get(&filter.name) {
                        Some(e) => e,
                        None => return Ok(false),
                    };
                    match evaluator.evaluate(feature_key, filter, context) {
                        Ok(true) => continue,
                        Ok(false) => return Ok(false),
                        Err(_) => return Ok(false),
                    }
                }
                Ok(true)
            }
            RequirementType::Any => {
                for filter in filters {
                    let evaluator = match self.registry.get(&filter.name) {
                        Some(e) => e,
                        None => continue,
                    };
                    if let Ok(true) = evaluator.evaluate(feature_key, filter, context) {
                        return Ok(true);
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

fn evaluate_entity_filters(
    definition: &FeatureDefinition,
    filters: &[&FeatureFilter],
    entity: &TogglyEntityContext,
) -> bool {
    if filters.is_empty() {
        return false;
    }
    let req = definition
        .context_requirement_type
        .unwrap_or(definition.requirement_type);
    let results: Vec<bool> = filters
        .iter()
        .map(|f| evaluate_context_property(f, entity))
        .collect();
    match req {
        RequirementType::All => results.iter().all(|v| *v),
        RequirementType::Any => results.iter().any(|v| *v),
    }
}

fn param<'a>(filter: &'a FeatureFilter, key: &str) -> Option<&'a serde_json::Value> {
    filter.parameters.get(key).or_else(|| {
        filter
            .parameters
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

fn value_as_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    }
}

pub(crate) fn evaluate_context_property(filter: &FeatureFilter, entity: &TogglyEntityContext) -> bool {
    let property = param(filter, "Property").map(value_as_string).unwrap_or_default();
    let op = param(filter, "Operator")
        .map(value_as_string)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let expected = match param(filter, "Value") {
        Some(v) => value_as_string(v),
        None => return false,
    };
    let value_type = param(filter, "ValueType")
        .map(value_as_string)
        .unwrap_or_else(|| "string".to_string())
        .to_ascii_lowercase();
    if property.trim().is_empty() || op.trim().is_empty() {
        return false;
    }
    if !entity.contains_attr(&property) {
        return false;
    }
    let actual = entity.get_attr(&property);
    compare_context(actual, &op, &expected, &value_type)
}

fn compare_context(
    actual: Option<&serde_json::Value>,
    op: &str,
    expected: &str,
    value_type: &str,
) -> bool {
    let actual_s = actual
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string().trim_matches('"').to_string(),
        })
        .unwrap_or_default();
    match op {
        "eq" => actual_s.eq_ignore_ascii_case(expected),
        "neq" => !actual_s.eq_ignore_ascii_case(expected),
        "gt" | "gte" | "lt" | "lte" => compare_ordered(actual, expected, value_type, op),
        "in" => expected
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .any(|c| c.eq_ignore_ascii_case(&actual_s)),
        "contains" => {
            if value_type == "string[]" {
                if let Some(serde_json::Value::Array(arr)) = actual {
                    return arr.iter().any(|v| value_as_string(v).eq_ignore_ascii_case(expected));
                }
                return false;
            }
            actual_s.to_ascii_lowercase().contains(&expected.to_ascii_lowercase())
        }
        _ => false,
    }
}

fn compare_ordered(
    actual: Option<&serde_json::Value>,
    expected: &str,
    value_type: &str,
    op: &str,
) -> bool {
    if value_type == "number" {
        let a = actual.and_then(|v| v.as_f64()).or_else(|| {
            actual.map(value_as_string).and_then(|s| s.parse().ok())
        });
        let e: Option<f64> = expected.parse().ok();
        let (Some(a), Some(e)) = (a, e) else {
            return false;
        };
        return match op {
            "gt" => a > e,
            "gte" => a >= e,
            "lt" => a < e,
            "lte" => a <= e,
            _ => false,
        };
    }
    if value_type == "datetime" {
        let a = actual
            .map(value_as_string)
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok());
        let e = chrono::DateTime::parse_from_rfc3339(expected).ok();
        let (Some(a), Some(e)) = (a, e) else {
            return false;
        };
        return match op {
            "gt" => a > e,
            "gte" => a >= e,
            "lt" => a < e,
            "lte" => a <= e,
            _ => false,
        };
    }
    false
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
    use std::collections::HashMap;

    fn make_definition(
        key: &str,
        filters: Vec<(&str, serde_json::Value)>,
        req: RequirementType,
    ) -> FeatureDefinition {
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
            context_kind: None,
            context_requirement_type: None,
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
        let def = make_definition(
            "test",
            vec![("AlwaysOn", serde_json::json!({}))],
            RequirementType::Any,
        );

        let result = engine.evaluate(&def, &EvalContext::default()).unwrap();
        assert!(result);
    }

    #[test]
    fn test_engine_always_off() {
        let engine = Engine::with_defaults();
        let def = make_definition(
            "test",
            vec![("AlwaysOff", serde_json::json!({}))],
            RequirementType::Any,
        );

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
            vec![("UnknownFilter", serde_json::json!({}))],
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

    #[test]
    fn test_context_property_and_user() {
        let engine = Engine::with_defaults();
        let mut def = make_definition(
            "puppies",
            vec![
                (
                    "ContextProperty",
                    serde_json::json!({"Property":"Color","Operator":"eq","Value":"red","ValueType":"string"}),
                ),
                ("AlwaysOn", serde_json::json!({})),
            ],
            RequirementType::Any,
        );
        def.context_requirement_type = Some(RequirementType::All);
        let entity = crate::context::TogglyEntityContext {
            kind: "Puppy".into(),
            key: "1".into(),
            attributes: HashMap::from([("color".into(), serde_json::json!("red"))]),
        };
        let ctx = EvalContext::builder().entity(entity).build();
        assert!(engine.evaluate(&def, &ctx).unwrap());
        assert!(!engine.evaluate(&def, &EvalContext::default()).unwrap());
    }
}
