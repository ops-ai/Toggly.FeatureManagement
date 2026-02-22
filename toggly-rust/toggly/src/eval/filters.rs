//! Built-in filter evaluators.

use crate::context::EvalContext;
use crate::definitions::FeatureFilter;
use crate::eval::registry::Evaluator;
use sha2::{Digest, Sha256};

/// AlwaysOn filter evaluator - always returns true.
pub struct AlwaysOnEvaluator;

impl Evaluator for AlwaysOnEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        _filter: &FeatureFilter,
        _context: &EvalContext,
    ) -> crate::Result<bool> {
        Ok(true)
    }
}

/// AlwaysOff filter evaluator - always returns false.
pub struct AlwaysOffEvaluator;

impl Evaluator for AlwaysOffEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        _filter: &FeatureFilter,
        _context: &EvalContext,
    ) -> crate::Result<bool> {
        Ok(false)
    }
}

/// Percentage rollout filter evaluator.
pub struct PercentageEvaluator;

impl PercentageEvaluator {
    /// Calculate a deterministic percentage based on identity and feature key.
    fn calculate_percentage(identity: &str, feature_key: &str) -> f64 {
        let mut hasher = Sha256::new();
        hasher.update(identity.as_bytes());
        hasher.update(feature_key.as_bytes());
        let result = hasher.finalize();

        // Use first 4 bytes as u32 and normalize to 0-100
        let value = u32::from_be_bytes([result[0], result[1], result[2], result[3]]);
        (value as f64 / u32::MAX as f64) * 100.0
    }
}

impl Evaluator for PercentageEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = filter
            .parameters
            .get("Value")
            .or_else(|| filter.parameters.get("value"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // If no identity, use random percentage (non-deterministic)
        let identity = match &context.identity {
            Some(id) if !id.is_empty() => id.as_str(),
            _ => {
                // For anonymous users, use a random value
                let random_pct = rand::random::<f64>() * 100.0;
                return Ok(random_pct < percentage);
            }
        };

        let calculated = Self::calculate_percentage(identity, feature_key);
        Ok(calculated < percentage)
    }
}

/// Targeting filter evaluator for identity-based targeting.
pub struct TargetingEvaluator;

impl Evaluator for TargetingEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let identity = match &context.identity {
            Some(id) if !id.is_empty() => id,
            _ => return Ok(false),
        };

        // Check Audience (list of identities)
        if let Some(audience) = filter
            .parameters
            .get("Audience")
            .or_else(|| filter.parameters.get("audience"))
        {
            if let Some(arr) = audience.as_array() {
                let identities: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                if identities.contains(&identity.as_str()) {
                    return Ok(true);
                }
            }
            if let Some(s) = audience.as_str() {
                // Comma-separated list
                let identities: Vec<&str> = s.split(',').map(|s| s.trim()).collect();
                if identities.contains(&identity.as_str()) {
                    return Ok(true);
                }
            }
        }

        // Check Groups
        if let Some(groups) = filter
            .parameters
            .get("Groups")
            .or_else(|| filter.parameters.get("groups"))
        {
            if let Some(arr) = groups.as_array() {
                let target_groups: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                for group in &context.groups {
                    if target_groups.contains(&group.as_str()) {
                        return Ok(true);
                    }
                }
            }
        }

        // Check DefaultRolloutPercentage for catch-all percentage
        if let Some(default_pct) = filter
            .parameters
            .get("DefaultRolloutPercentage")
            .or_else(|| filter.parameters.get("defaultRolloutPercentage"))
            .and_then(|v| v.as_f64())
        {
            if default_pct > 0.0 {
                let calculated = PercentageEvaluator::calculate_percentage(identity, _feature_key);
                return Ok(calculated < default_pct);
            }
        }

        Ok(false)
    }
}

/// Time window filter evaluator.
pub struct TimeWindowEvaluator;

impl Evaluator for TimeWindowEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        filter: &FeatureFilter,
        _context: &EvalContext,
    ) -> crate::Result<bool> {
        let now = chrono::Utc::now();

        // Check Start time
        if let Some(start) = filter
            .parameters
            .get("Start")
            .or_else(|| filter.parameters.get("start"))
        {
            if let Some(start_str) = start.as_str() {
                if let Ok(start_time) = chrono::DateTime::parse_from_rfc3339(start_str) {
                    if now < start_time {
                        return Ok(false);
                    }
                }
            }
        }

        // Check End time
        if let Some(end) = filter
            .parameters
            .get("End")
            .or_else(|| filter.parameters.get("end"))
        {
            if let Some(end_str) = end.as_str() {
                if let Ok(end_time) = chrono::DateTime::parse_from_rfc3339(end_str) {
                    if now > end_time {
                        return Ok(false);
                    }
                }
            }
        }

        Ok(true)
    }
}

/// Contextual targeting filter evaluator for trait-based targeting.
pub struct ContextualTargetingEvaluator;

impl ContextualTargetingEvaluator {
    fn evaluate_condition(
        context: &EvalContext,
        trait_name: &str,
        operator: &str,
        expected_value: &serde_json::Value,
    ) -> bool {
        let actual_value = match context.traits.get(trait_name) {
            Some(v) => v,
            None => return operator == "NotExists" || operator == "notExists",
        };

        match operator {
            "Equals" | "equals" | "eq" => actual_value == expected_value,
            "NotEquals" | "notEquals" | "ne" => actual_value != expected_value,
            "Contains" | "contains" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_str(), expected_value.as_str())
                {
                    actual.contains(expected)
                } else {
                    false
                }
            }
            "StartsWith" | "startsWith" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_str(), expected_value.as_str())
                {
                    actual.starts_with(expected)
                } else {
                    false
                }
            }
            "EndsWith" | "endsWith" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_str(), expected_value.as_str())
                {
                    actual.ends_with(expected)
                } else {
                    false
                }
            }
            "GreaterThan" | "greaterThan" | "gt" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_f64(), expected_value.as_f64())
                {
                    actual > expected
                } else {
                    false
                }
            }
            "LessThan" | "lessThan" | "lt" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_f64(), expected_value.as_f64())
                {
                    actual < expected
                } else {
                    false
                }
            }
            "GreaterThanOrEqual" | "greaterThanOrEqual" | "gte" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_f64(), expected_value.as_f64())
                {
                    actual >= expected
                } else {
                    false
                }
            }
            "LessThanOrEqual" | "lessThanOrEqual" | "lte" => {
                if let (Some(actual), Some(expected)) =
                    (actual_value.as_f64(), expected_value.as_f64())
                {
                    actual <= expected
                } else {
                    false
                }
            }
            "In" | "in" => {
                if let Some(arr) = expected_value.as_array() {
                    arr.contains(actual_value)
                } else {
                    false
                }
            }
            "NotIn" | "notIn" => {
                if let Some(arr) = expected_value.as_array() {
                    !arr.contains(actual_value)
                } else {
                    true
                }
            }
            "Exists" | "exists" => true,
            "NotExists" | "notExists" => false,
            "Matches" | "matches" | "regex" => {
                if let (Some(actual), Some(pattern)) =
                    (actual_value.as_str(), expected_value.as_str())
                {
                    regex::Regex::new(pattern)
                        .map(|re| re.is_match(actual))
                        .unwrap_or(false)
                } else {
                    false
                }
            }
            _ => false,
        }
    }
}

impl Evaluator for ContextualTargetingEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        // Get conditions array
        let conditions = match filter
            .parameters
            .get("Conditions")
            .or_else(|| filter.parameters.get("conditions"))
        {
            Some(v) if v.is_array() => v.as_array().unwrap(),
            _ => return Ok(false),
        };

        // Get requirement type (default to "All")
        let requirement = filter
            .parameters
            .get("RequirementType")
            .or_else(|| filter.parameters.get("requirementType"))
            .and_then(|v| v.as_str())
            .unwrap_or("All");

        let results: Vec<bool> = conditions
            .iter()
            .filter_map(|cond| {
                let obj = cond.as_object()?;
                let trait_name = obj.get("trait")?.as_str()?;
                let operator = obj.get("operator")?.as_str()?;
                let value = obj.get("value")?;

                Some(Self::evaluate_condition(
                    context, trait_name, operator, value,
                ))
            })
            .collect();

        if results.is_empty() {
            return Ok(false);
        }

        match requirement {
            "All" | "all" => Ok(results.iter().all(|&v| v)),
            "Any" | "any" => Ok(results.iter().any(|&v| v)),
            _ => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn make_filter(name: &str, params: serde_json::Value) -> FeatureFilter {
        FeatureFilter {
            name: name.to_string(),
            parameters: params
                .as_object()
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default(),
        }
    }

    #[test]
    fn test_always_on() {
        let evaluator = AlwaysOnEvaluator;
        let filter = make_filter("AlwaysOn", serde_json::json!({}));
        let result = evaluator
            .evaluate("test", &filter, &EvalContext::default())
            .unwrap();
        assert!(result);
    }

    #[test]
    fn test_always_off() {
        let evaluator = AlwaysOffEvaluator;
        let filter = make_filter("AlwaysOff", serde_json::json!({}));
        let result = evaluator
            .evaluate("test", &filter, &EvalContext::default())
            .unwrap();
        assert!(!result);
    }

    #[test]
    fn test_percentage_with_identity() {
        let evaluator = PercentageEvaluator;
        let filter = make_filter("Percentage", serde_json::json!({"Value": 50}));
        let context = EvalContext::with_identity("user-123");

        // Should be deterministic
        let result1 = evaluator.evaluate("feature", &filter, &context).unwrap();
        let result2 = evaluator.evaluate("feature", &filter, &context).unwrap();
        assert_eq!(result1, result2);
    }

    #[test]
    fn test_targeting_with_audience() {
        let evaluator = TargetingEvaluator;
        let filter = make_filter(
            "Targeting",
            serde_json::json!({"Audience": ["user-1", "user-2", "user-3"]}),
        );

        let context1 = EvalContext::with_identity("user-2");
        assert!(evaluator.evaluate("test", &filter, &context1).unwrap());

        let context2 = EvalContext::with_identity("user-99");
        assert!(!evaluator.evaluate("test", &filter, &context2).unwrap());
    }

    #[test]
    fn test_targeting_with_groups() {
        let evaluator = TargetingEvaluator;
        let filter = make_filter(
            "Targeting",
            serde_json::json!({"Groups": ["beta", "premium"]}),
        );

        let context1 = EvalContext::builder()
            .identity("user-1")
            .group("beta")
            .build();
        assert!(evaluator.evaluate("test", &filter, &context1).unwrap());

        let context2 = EvalContext::builder()
            .identity("user-2")
            .group("free")
            .build();
        assert!(!evaluator.evaluate("test", &filter, &context2).unwrap());
    }

    #[test]
    fn test_contextual_targeting() {
        let evaluator = ContextualTargetingEvaluator;
        let filter = make_filter(
            "ContextualTargeting",
            serde_json::json!({
                "Conditions": [
                    {"trait": "country", "operator": "Equals", "value": "US"},
                    {"trait": "age", "operator": "GreaterThan", "value": 18}
                ],
                "RequirementType": "All"
            }),
        );

        let mut traits = HashMap::new();
        traits.insert("country".to_string(), serde_json::json!("US"));
        traits.insert("age".to_string(), serde_json::json!(25));

        let context = EvalContext::builder().traits(traits).build();
        assert!(evaluator.evaluate("test", &filter, &context).unwrap());
    }
}
