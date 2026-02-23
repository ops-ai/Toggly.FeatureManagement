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
    #[serde(default)]
    pub filters: Vec<FeatureFilter>,

    /// Associated metrics.
    #[serde(default)]
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

/// Signed definitions response from v2 endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedDefinitionsResponse {
    /// Raw JSON definitions for signature verification.
    pub defs: serde_json::Value,

    /// Signature.
    pub signature: String,

    /// Timestamp.
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
        };

        assert!(def.has_filters());
        assert!(def.get_filter("Targeting").is_some());
        assert!(def.get_filter("Unknown").is_none());
    }
}
