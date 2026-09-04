//! Built-in filter evaluators.

use crate::context::EvalContext;
use crate::definitions::FeatureFilter;
use crate::eval::registry::Evaluator;
use crate::eval::sticky_hash::{compute_percentile, segment_percentage_passes};
use crate::eval::user_agent::parse_user_agent;

fn param<'a>(filter: &'a FeatureFilter, key: &str) -> Option<&'a serde_json::Value> {
    filter.parameters.get(key).or_else(|| {
        filter
            .parameters
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

fn as_float(filter: &FeatureFilter, keys: &[&str]) -> Option<f64> {
    for key in keys {
        let Some(value) = param(filter, key) else {
            continue;
        };
        if value.is_boolean() {
            continue;
        }
        if let Some(n) = value.as_f64() {
            return Some(n);
        }
        if let Some(s) = value.as_str() {
            if let Ok(n) = s.parse::<f64>() {
                return Some(n);
            }
            return None;
        }
        return None;
    }
    None
}

fn as_string(filter: &FeatureFilter, key: &str) -> Option<String> {
    let value = param(filter, key)?;
    let text = match value {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string().trim_matches('"').to_string(),
    };
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn collect_indexed_values(filter: &FeatureFilter, prefixes: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    for (key, value) in &filter.parameters {
        if value.is_null() {
            continue;
        }
        for prefix in prefixes {
            let needle = format!("{prefix}:");
            if key.starts_with(&needle) {
                let text = match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string().trim_matches('"').to_string(),
                };
                if !text.is_empty() {
                    out.push(text);
                }
                break;
            }
        }
    }
    out
}

fn contains_ignore_case(haystack: &str, needle: &str) -> bool {
    haystack
        .to_ascii_lowercase()
        .contains(&needle.to_ascii_lowercase())
}

fn equals_ignore_case(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn identity_str(context: &EvalContext) -> Option<&str> {
    context.identity.as_deref().filter(|s| !s.is_empty())
}

fn append_list_values(out: &mut Vec<String>, raw: Option<&serde_json::Value>) {
    let Some(raw) = raw else {
        return;
    };
    match raw {
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(s) = item.as_str() {
                    if !s.is_empty() {
                        out.push(s.to_string());
                    }
                } else {
                    let text = item.to_string().trim_matches('"').to_string();
                    if !text.is_empty() {
                        out.push(text);
                    }
                }
            }
        }
        serde_json::Value::String(s) => {
            for part in s.split(',') {
                let trimmed = part.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
            }
        }
        other => {
            let text = other.to_string().trim_matches('"').to_string();
            if !text.is_empty() {
                out.push(text);
            }
        }
    }
}

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
///
/// Uses Definitions-aligned sticky SHA-256 hashing
/// (`featureKey + "\n" + identity`) for consistent buckets.
pub struct PercentageEvaluator;

impl Evaluator for PercentageEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Value", "Percentage", "percentage", "value"]);
        let Some(percentage) = percentage else {
            return Ok(false);
        };
        if percentage <= 0.0 {
            return Ok(false);
        }
        if percentage >= 100.0 {
            return Ok(true);
        }
        let Some(identity) = identity_str(context) else {
            return Ok(false);
        };
        Ok(compute_percentile(identity, feature_key) < percentage)
    }
}

/// Targeting filter evaluator for identity-based targeting.
pub struct TargetingEvaluator;

impl TargetingEvaluator {
    fn collect_users(filter: &FeatureFilter) -> Vec<String> {
        let mut users = Vec::new();
        append_list_values(
            &mut users,
            param(filter, "users").or_else(|| param(filter, "Users")),
        );
        append_list_values(
            &mut users,
            param(filter, "Audience").or_else(|| param(filter, "audience")),
        );
        for (key, value) in &filter.parameters {
            if key.starts_with("Audience.Users:") && !value.is_null() {
                append_list_values(&mut users, Some(value));
            }
        }
        users.sort();
        users.dedup();
        users
    }

    fn collect_groups(filter: &FeatureFilter) -> Vec<String> {
        let mut groups = Vec::new();
        append_list_values(
            &mut groups,
            param(filter, "groups").or_else(|| param(filter, "Groups")),
        );
        for (key, value) in &filter.parameters {
            if key.starts_with("Audience.Groups:") && !value.is_null() {
                append_list_values(&mut groups, Some(value));
            }
        }
        groups.sort();
        groups.dedup();
        groups
    }
}

impl Evaluator for TargetingEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let users = Self::collect_users(filter);
        if let Some(identity) = identity_str(context) {
            if users.iter().any(|u| u == identity) {
                return Ok(true);
            }
        }

        let groups = Self::collect_groups(filter);
        if !groups.is_empty()
            && context
                .groups
                .iter()
                .any(|g| groups.iter().any(|tg| tg == g))
        {
            return Ok(true);
        }

        let default_percentage = as_float(
            filter,
            &[
                "Audience.DefaultRolloutPercentage",
                "DefaultRolloutPercentage",
                "defaultRolloutPercentage",
                "default_percentage",
                "Percentage",
            ],
        )
        .unwrap_or(0.0);
        if default_percentage > 0.0 {
            if let Some(identity) = identity_str(context) {
                return Ok(compute_percentile(identity, feature_key) < default_percentage);
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

        if let Some(start) = param(filter, "Start").or_else(|| param(filter, "start")) {
            if let Some(start_str) = start.as_str() {
                if let Ok(start_time) = chrono::DateTime::parse_from_rfc3339(start_str) {
                    if now < start_time {
                        return Ok(false);
                    }
                }
            }
        }

        if let Some(end) = param(filter, "End").or_else(|| param(filter, "end")) {
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
        let conditions = match param(filter, "Conditions").or_else(|| param(filter, "conditions")) {
            Some(v) if v.is_array() => v.as_array().unwrap(),
            _ => return Ok(false),
        };

        let requirement = param(filter, "RequirementType")
            .or_else(|| param(filter, "requirementType"))
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

/// ContextProperty filter evaluator. Fail closed.
pub struct ContextPropertyEvaluator;

impl Evaluator for ContextPropertyEvaluator {
    fn evaluate(
        &self,
        _feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let Some(entity) = &context.entity else {
            return Ok(false);
        };
        Ok(super::engine::evaluate_context_property(filter, entity))
    }
}

/// BrowserFamily segment filter evaluator.
pub struct BrowserFamilyEvaluator;

impl Evaluator for BrowserFamilyEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let values = collect_indexed_values(filter, &["BrowserFamily"]);
        if values.is_empty() {
            return Ok(false);
        }
        let ua = context
            .request
            .as_ref()
            .and_then(|r| r.user_agent.as_deref());
        let Some(parsed) = parse_user_agent(ua) else {
            return Ok(false);
        };
        if parsed.browser_family == "Other" {
            return Ok(false);
        }
        Ok(values
            .iter()
            .any(|value| contains_ignore_case(&parsed.browser_family, value)))
    }
}

/// BrowserLanguage segment filter evaluator.
pub struct BrowserLanguageEvaluator;

impl Evaluator for BrowserLanguageEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let values = collect_indexed_values(filter, &["BrowserLanguage"]);
        if values.is_empty() {
            return Ok(false);
        }
        let Some(accept) = context
            .request
            .as_ref()
            .and_then(|r| r.accept_language.as_deref())
            .filter(|s| !s.is_empty())
        else {
            return Ok(false);
        };
        Ok(values
            .iter()
            .any(|value| contains_ignore_case(accept, value)))
    }
}

/// Country / CountryFamily segment filter evaluator.
pub struct CountryEvaluator;

impl Evaluator for CountryEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let values = collect_indexed_values(filter, &["Country"]);
        if values.is_empty() {
            return Ok(false);
        }
        let Some(country) = context
            .request
            .as_ref()
            .and_then(|r| r.country.as_deref())
            .filter(|s| !s.is_empty())
        else {
            return Ok(false);
        };
        Ok(values
            .iter()
            .any(|value| equals_ignore_case(value, country)))
    }
}

/// DeviceType segment filter evaluator.
pub struct DeviceTypeEvaluator;

impl Evaluator for DeviceTypeEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let values = collect_indexed_values(filter, &["DeviceType"]);
        if values.is_empty() {
            return Ok(false);
        }
        let ua = context
            .request
            .as_ref()
            .and_then(|r| r.user_agent.as_deref());
        let Some(parsed) = parse_user_agent(ua) else {
            return Ok(false);
        };
        if parsed.device_family == "Other" {
            return Ok(false);
        }
        Ok(values
            .iter()
            .any(|value| contains_ignore_case(&parsed.device_family, value)))
    }
}

/// OS / OperatingSystem segment filter evaluator.
pub struct OperatingSystemEvaluator;

impl Evaluator for OperatingSystemEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let values = collect_indexed_values(filter, &["OperatingSystem"]);
        if values.is_empty() {
            return Ok(false);
        }
        let ua = context
            .request
            .as_ref()
            .and_then(|r| r.user_agent.as_deref());
        let Some(parsed) = parse_user_agent(ua) else {
            return Ok(false);
        };
        if parsed.os_family == "Other" {
            return Ok(false);
        }
        Ok(values
            .iter()
            .any(|value| contains_ignore_case(&parsed.os_family, value)))
    }
}

/// UserClaims filter evaluator (`Claim` + `Value`).
pub struct UserClaimsEvaluator;

impl Evaluator for UserClaimsEvaluator {
    fn evaluate(
        &self,
        feature_key: &str,
        filter: &FeatureFilter,
        context: &EvalContext,
    ) -> crate::Result<bool> {
        let percentage = as_float(filter, &["Percentage"]);
        if !segment_percentage_passes(percentage, feature_key, identity_str(context)) {
            return Ok(false);
        }
        let Some(claim_type) = as_string(filter, "Claim") else {
            return Ok(false);
        };
        let Some(claim_value) = as_string(filter, "Value") else {
            return Ok(false);
        };
        match context.claims.get(&claim_type) {
            Some(actual) => Ok(actual == &claim_value),
            None => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::RequestContext;
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

        let result1 = evaluator.evaluate("feature", &filter, &context).unwrap();
        let result2 = evaluator.evaluate("feature", &filter, &context).unwrap();
        assert_eq!(result1, result2);
    }

    #[test]
    fn test_percentage_missing_fail_closed() {
        let evaluator = PercentageEvaluator;
        let filter = make_filter("Percentage", serde_json::json!({}));
        let context = EvalContext::with_identity("user-123");
        assert!(!evaluator.evaluate("feature", &filter, &context).unwrap());
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
    fn test_targeting_with_indexed_groups() {
        let evaluator = TargetingEvaluator;
        let filter = make_filter(
            "Targeting",
            serde_json::json!({
                "Audience.DefaultRolloutPercentage": 0,
                "Audience.Groups:0": "beta"
            }),
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

    #[test]
    fn test_browser_family_match() {
        let evaluator = BrowserFamilyEvaluator;
        let filter = make_filter(
            "BrowserFamily",
            serde_json::json!({
                "Percentage": 100,
                "BrowserFamily:0": "Chrome"
            }),
        );
        let context = EvalContext::builder()
            .identity("u")
            .request(RequestContext {
                user_agent: Some(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".into(),
                ),
                ..Default::default()
            })
            .build();
        assert!(evaluator.evaluate("parity", &filter, &context).unwrap());
    }

    #[test]
    fn test_user_claims_match() {
        let evaluator = UserClaimsEvaluator;
        let filter = make_filter(
            "UserClaims",
            serde_json::json!({
                "Percentage": 100,
                "Claim": "role",
                "Value": "admin"
            }),
        );
        let context = EvalContext::builder()
            .identity("u")
            .claim("role", "admin")
            .build();
        assert!(evaluator.evaluate("parity", &filter, &context).unwrap());
    }
}
