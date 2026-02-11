//! Evaluation context for feature flag checks.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Context for feature flag evaluation.
///
/// Provides user information and attributes for targeting rules.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EvalContext {
    /// Unique identifier for the user/device.
    pub identity: Option<String>,

    /// Group identifiers (e.g., "beta-testers", "premium").
    pub groups: Vec<String>,

    /// Custom attributes for targeting rules.
    pub traits: HashMap<String, serde_json::Value>,
}

impl EvalContext {
    /// Create a new evaluation context builder.
    pub fn builder() -> EvalContextBuilder {
        EvalContextBuilder::default()
    }

    /// Create a context with just an identity.
    pub fn with_identity(identity: impl Into<String>) -> Self {
        Self {
            identity: Some(identity.into()),
            ..Default::default()
        }
    }

    /// Check if the context has an identity.
    pub fn has_identity(&self) -> bool {
        self.identity.as_ref().map_or(false, |id| !id.is_empty())
    }

    /// Get a trait value.
    pub fn get_trait(&self, key: &str) -> Option<&serde_json::Value> {
        self.traits.get(key)
    }

    /// Check if the context belongs to a group.
    pub fn in_group(&self, group: &str) -> bool {
        self.groups.iter().any(|g| g == group)
    }
}

/// Builder for [`EvalContext`].
#[derive(Debug, Default)]
pub struct EvalContextBuilder {
    context: EvalContext,
}

impl EvalContextBuilder {
    /// Set the identity.
    pub fn identity(mut self, identity: impl Into<String>) -> Self {
        self.context.identity = Some(identity.into());
        self
    }

    /// Set the groups.
    pub fn groups(mut self, groups: Vec<String>) -> Self {
        self.context.groups = groups;
        self
    }

    /// Add a group.
    pub fn group(mut self, group: impl Into<String>) -> Self {
        self.context.groups.push(group.into());
        self
    }

    /// Set the traits.
    pub fn traits(mut self, traits: HashMap<String, serde_json::Value>) -> Self {
        self.context.traits = traits;
        self
    }

    /// Add a trait.
    pub fn trait_value(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.context.traits.insert(key.into(), value.into());
        self
    }

    /// Build the context.
    pub fn build(self) -> EvalContext {
        self.context
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_context() {
        let ctx = EvalContext::default();
        assert!(ctx.identity.is_none());
        assert!(ctx.groups.is_empty());
        assert!(ctx.traits.is_empty());
    }

    #[test]
    fn test_with_identity() {
        let ctx = EvalContext::with_identity("user-123");
        assert_eq!(ctx.identity, Some("user-123".to_string()));
    }

    #[test]
    fn test_builder() {
        let ctx = EvalContext::builder()
            .identity("user-123")
            .group("beta")
            .group("premium")
            .trait_value("country", "US")
            .trait_value("age", 25)
            .build();

        assert_eq!(ctx.identity, Some("user-123".to_string()));
        assert_eq!(ctx.groups, vec!["beta", "premium"]);
        assert_eq!(ctx.get_trait("country"), Some(&serde_json::json!("US")));
        assert_eq!(ctx.get_trait("age"), Some(&serde_json::json!(25)));
    }

    #[test]
    fn test_has_identity() {
        let ctx = EvalContext::default();
        assert!(!ctx.has_identity());

        let ctx = EvalContext::with_identity("");
        assert!(!ctx.has_identity());

        let ctx = EvalContext::with_identity("user-123");
        assert!(ctx.has_identity());
    }

    #[test]
    fn test_in_group() {
        let ctx = EvalContext::builder()
            .group("beta")
            .group("premium")
            .build();

        assert!(ctx.in_group("beta"));
        assert!(ctx.in_group("premium"));
        assert!(!ctx.in_group("admin"));
    }
}
