//! Feature definition types matching the Toggly API.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// Deserialize null JSON values as the type's Default.
fn deserialize_null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// Requirement type for feature filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum RequirementType {
    /// At least one filter must pass.
    #[default]
    Any,
    /// All filters must pass.
    All,
}

/// A feature filter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureFilter {
    /// Filter name (e.g., "Targeting", "Percentage").
    pub name: String,

    /// Filter parameters.
    #[serde(default, deserialize_with = "deserialize_null_as_default")]
    pub parameters: HashMap<String, serde_json::Value>,
}

/// Feature definition model from the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDefinition {
    /// Feature key/name.
    pub feature_key: String,

    /// Feature filters for evaluation.
    #[serde(default, deserialize_with = "deserialize_null_as_default")]
    pub filters: Vec<FeatureFilter>,

    /// Associated metrics.
    #[serde(default, deserialize_with = "deserialize_null_as_default")]
    pub metrics: Vec<String>,

    /// Whether this is a secured feature.
    #[serde(default)]
    pub secured_feature: bool,

    /// Whether client SDK is enabled for this feature.
    #[serde(default)]
    pub client_sdk_enabled: bool,

    /// Requirement type for multiple filters.
    #[serde(default)]
    pub requirement_type: RequirementType,

    /// Optional entity context kind.
    #[serde(default)]
    pub context_kind: Option<String>,

    /// Any/All for ContextProperty filters.
    #[serde(default)]
    pub context_requirement_type: Option<RequirementType>,

    /// Named variants available for this feature (MF-parity variant assignment).
    #[serde(default, deserialize_with = "deserialize_null_as_default")]
    pub variants: Vec<Variant>,

    /// Allocation rules (user/group/percentile + defaults) for variant assignment.
    #[serde(default)]
    pub allocation: Option<Allocation>,
}

/// A variant's effective status override on the feature's enabled state.
///
/// Mirrors `Microsoft.FeatureManagement.VariantStatusOverride`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum StatusOverride {
    /// No override; the feature's filter-evaluated enabled state stands.
    #[default]
    None,
    /// Force the effective enabled state to `true` once this variant is assigned.
    Enabled,
    /// Force the effective enabled state to `false` once this variant is assigned.
    Disabled,
}

/// A named feature variant with its configuration payload and status override.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    /// Variant name (referenced by allocation rules).
    pub name: String,

    /// Untyped configuration payload for this variant (object, scalar, or null).
    #[serde(default)]
    pub configuration_value: Option<serde_json::Value>,

    /// Effective-enabled override applied once this variant is assigned.
    #[serde(default)]
    pub status_override: StatusOverride,
}

/// User-targeted variant allocation rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAllocation {
    /// Variant assigned when the identity matches `users`.
    pub variant: String,

    /// User identities that resolve to `variant`.
    #[serde(default)]
    pub users: Vec<String>,
}

/// Group-targeted variant allocation rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupAllocation {
    /// Variant assigned when a context group matches.
    pub variant: String,

    /// Groups that resolve to `variant`.
    #[serde(default)]
    pub groups: Vec<String>,
}

/// Percentile-bucket variant allocation rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PercentileAllocation {
    /// Variant assigned when the hashed percentile lands in `[from, to)`.
    pub variant: String,

    /// Inclusive lower bound (0-100).
    pub from: f64,

    /// Exclusive upper bound (0-100), except `to == 100` is inclusive/unbounded.
    pub to: f64,
}

/// Variant allocation rules for a feature (MF-parity: user, group, percentile,
/// and enabled/disabled defaults).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    /// Variant assigned when the feature is enabled and no rule matches.
    #[serde(default)]
    pub default_when_enabled: Option<String>,

    /// Variant assigned when the feature is disabled.
    #[serde(default)]
    pub default_when_disabled: Option<String>,

    /// Custom percentile hash seed; defaults to `allocation\n{featureKey}`.
    #[serde(default)]
    pub seed: Option<String>,

    /// User allocation rules, evaluated first (in order) when enabled.
    #[serde(default)]
    pub user: Option<Vec<UserAllocation>>,

    /// Group allocation rules, evaluated after user rules when enabled.
    #[serde(default)]
    pub group: Option<Vec<GroupAllocation>>,

    /// Percentile allocation rules, evaluated after group rules when enabled.
    #[serde(default)]
    pub percentile: Option<Vec<PercentileAllocation>>,
}

impl FeatureDefinition {
    /// Check if the feature has any filters.
    pub fn has_filters(&self) -> bool {
        !self.filters.is_empty()
    }

    /// Get a filter by name.
    pub fn get_filter(&self, name: &str) -> Option<&FeatureFilter> {
        self.filters.iter().find(|f| f.name == name)
    }
}

/// Response from the definitions endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefinitionsResponse {
    /// List of feature definitions.
    #[serde(flatten)]
    pub definitions: HashMap<String, FeatureDefinition>,
}

/// Signed definitions response from definitions-signed / evaluated-signed.
///
/// IMPORTANT: `defs` is raw JSON so signature verification uses the exact
/// server-signed payload (never re-serialize for verify).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedDefinitionsResponse {
    /// Exact raw JSON bytes of the `"defs"` property.
    pub defs: Box<serde_json::value::RawValue>,

    /// Signature (standard base64).
    pub signature: String,

    /// Timestamp (Unix seconds).
    pub timestamp: i64,

    /// Key ID.
    pub kid: String,
}

/// JSON Web Key Set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwkSet {
    /// List of keys.
    pub keys: Vec<Jwk>,
}

/// JSON Web Key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jwk {
    /// Key type (e.g., "EC").
    pub kty: String,

    /// Key use (e.g., "sig").
    #[serde(rename = "use")]
    pub use_: Option<String>,

    /// Key ID.
    pub kid: String,

    /// Curve (for EC keys).
    pub crv: Option<String>,

    /// X coordinate (for EC keys).
    pub x: Option<String>,

    /// Y coordinate (for EC keys).
    pub y: Option<String>,

    /// Algorithm.
    pub alg: Option<String>,

    /// Expiration timestamp.
    pub exp: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_feature_definition() {
        let json = r#"{
            "featureKey": "my-feature",
            "filters": [
                {
                    "name": "AlwaysOn",
                    "parameters": {}
                }
            ],
            "metrics": [],
            "securedFeature": false,
            "clientSdkEnabled": true,
            "requirementType": "Any"
        }"#;

        let def: FeatureDefinition = serde_json::from_str(json).unwrap();
        assert_eq!(def.feature_key, "my-feature");
        assert_eq!(def.filters.len(), 1);
        assert_eq!(def.filters[0].name, "AlwaysOn");
        assert!(def.client_sdk_enabled);
        assert!(!def.secured_feature);
    }

    #[test]
    fn test_deserialize_feature_definition_null_variants() {
        // Production has emitted `"variants": null` (rather than omitting the
        // field or sending `[]`) for features with no variants configured.
        // `#[serde(default)]` alone only covers a missing key, so an explicit
        // `null` must fall back via `deserialize_null_as_default` or this
        // panics with "invalid type: null, expected a sequence".
        let json = r#"{
            "featureKey": "no-variants",
            "filters": [],
            "metrics": [],
            "securedFeature": false,
            "clientSdkEnabled": true,
            "requirementType": "Any",
            "variants": null,
            "allocation": null
        }"#;

        let def: FeatureDefinition = serde_json::from_str(json).unwrap();
        assert!(def.variants.is_empty());
        assert!(def.allocation.is_none());
    }

    #[test]
    fn test_deserialize_feature_definition_null_metrics_and_filters() {
        // The backend's Metrics (and, defensively, Filters) list is a nullable
        // C# property and has been observed emitting an explicit `null` (not
        // an omitted key or `[]`) for features with no metrics/filters
        // configured, e.g. the "FlagOn"/"FlagOff" smoke-test features. Same
        // failure mode as the variants case above: "invalid type: null,
        // expected a sequence" without `deserialize_null_as_default`.
        let json = r#"{
            "featureKey": "FlagOn",
            "filters": null,
            "metrics": null,
            "securedFeature": false,
            "clientSdkEnabled": true,
            "requirementType": "Any"
        }"#;

        let def: FeatureDefinition = serde_json::from_str(json).unwrap();
        assert!(def.filters.is_empty());
        assert!(def.metrics.is_empty());
    }

    #[test]
    fn test_feature_definition_methods() {
        let def = FeatureDefinition {
            feature_key: "test".to_string(),
            filters: vec![
                FeatureFilter {
                    name: "Targeting".to_string(),
                    parameters: HashMap::new(),
                },
                FeatureFilter {
                    name: "Percentage".to_string(),
                    parameters: HashMap::new(),
                },
            ],
            metrics: vec![],
            secured_feature: false,
            client_sdk_enabled: true,
            requirement_type: RequirementType::Any,
            context_kind: None,
            context_requirement_type: None,
            variants: vec![],
            allocation: None,
        };

        assert!(def.has_filters());
        assert!(def.get_filter("Targeting").is_some());
        assert!(def.get_filter("Unknown").is_none());
    }
}
