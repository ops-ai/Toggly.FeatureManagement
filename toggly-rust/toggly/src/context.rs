//! Evaluation context for feature flag checks.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Canonical entity instance for ContextProperty evaluation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TogglyEntityContext {
    /// Context kind (Order, Product, etc.).
    pub kind: String,
    /// Entity key.
    pub key: String,
    /// Attribute map used by ContextProperty filters.
    pub attributes: HashMap<String, serde_json::Value>,
}

impl TogglyEntityContext {
    /// Look up an attribute, ignoring key case.
    pub fn get_attr(&self, name: &str) -> Option<&serde_json::Value> {
        if let Some(v) = self.attributes.get(name) {
            return Some(v);
        }
        self.attributes
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v)
    }

    /// Whether the attribute exists (case-insensitive).
    pub fn contains_attr(&self, name: &str) -> bool {
        self.attributes.contains_key(name)
            || self.attributes.keys().any(|k| k.eq_ignore_ascii_case(name))
    }
}

/// HTTP request fields used by segment identity filters.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequestContext {
    /// User-Agent header value.
    #[serde(default, alias = "user_agent", rename = "userAgent")]
    pub user_agent: Option<String>,

    /// Accept-Language header value.
    #[serde(default, alias = "accept_language", rename = "acceptLanguage")]
    pub accept_language: Option<String>,

    /// Country code (e.g. from CF-IPCountry).
    #[serde(default)]
    pub country: Option<String>,
}

impl RequestContext {
    /// Whether any request field is set.
    pub fn is_empty(&self) -> bool {
        self.user_agent.as_ref().is_none_or(|s| s.is_empty())
            && self.accept_language.as_ref().is_none_or(|s| s.is_empty())
            && self.country.as_ref().is_none_or(|s| s.is_empty())
    }
}

/// Maps common HTTP headers into [`RequestContext`] fields.
///
/// Does not invent identity, groups, or claims — merge those separately.
pub struct HttpRequestMapper;

impl HttpRequestMapper {
    /// Build [`RequestContext`] from a header bag (case-insensitive keys).
    pub fn from_http_headers<I, K, V>(headers: I) -> RequestContext
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let mut user_agent = None;
        let mut accept_language = None;
        let mut cf_country = None;
        let mut vercel_country = None;
        let mut cloudfront_country = None;

        for (key, value) in headers {
            let value = value.as_ref();
            if value.is_empty() {
                continue;
            }
            let lower = key.as_ref().to_ascii_lowercase();
            match lower.as_str() {
                "user-agent" if user_agent.is_none() => {
                    user_agent = Some(value.to_string());
                }
                "accept-language" if accept_language.is_none() => {
                    accept_language = Some(value.to_string());
                }
                "cf-ipcountry" if cf_country.is_none() => {
                    cf_country = Some(value.to_string());
                }
                "x-vercel-ip-country" if vercel_country.is_none() => {
                    vercel_country = Some(value.to_string());
                }
                "cloudfront-viewer-country" if cloudfront_country.is_none() => {
                    cloudfront_country = Some(value.to_string());
                }
                _ => {}
            }
        }

        RequestContext {
            user_agent,
            accept_language,
            country: cf_country.or(vercel_country).or(cloudfront_country),
        }
    }

    /// Merge HTTP-mapped request fields over an existing evaluation context.
    pub fn merge_into<I, K, V>(headers: I, base: Option<&EvalContext>) -> EvalContext
    where
        I: IntoIterator<Item = (K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let request = Self::from_http_headers(headers);
        match base {
            Some(base) => {
                let mut ctx = base.clone();
                ctx.request = Some(request);
                ctx
            }
            None => EvalContext {
                request: Some(request),
                ..Default::default()
            },
        }
    }
}

/// Context for feature flag evaluation.
///
/// Provides user information and attributes for targeting rules.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EvalContext {
    /// Unique identifier for the user/device.
    pub identity: Option<String>,

    /// Group identifiers (e.g., "beta-testers", "premium").
    #[serde(default)]
    pub groups: Vec<String>,

    /// Principal / JWT-style claims for UserClaims filters.
    #[serde(default)]
    pub claims: HashMap<String, String>,

    /// Custom attributes for targeting rules.
    #[serde(default)]
    pub traits: HashMap<String, serde_json::Value>,

    /// HTTP request fields for segment filters.
    #[serde(default)]
    pub request: Option<RequestContext>,

    /// Entity for ContextProperty filters.
    #[serde(default)]
    pub entity: Option<TogglyEntityContext>,
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
        self.identity.as_ref().is_some_and(|id| !id.is_empty())
    }

    /// Get a trait value.
    pub fn get_trait(&self, key: &str) -> Option<&serde_json::Value> {
        self.traits.get(key)
    }

    /// Check if the context belongs to a group.
    pub fn in_group(&self, group: &str) -> bool {
        self.groups.iter().any(|g| g == group)
    }

    /// Look up a claim by exact type key.
    pub fn get_claim(&self, claim_type: &str) -> Option<&str> {
        self.claims.get(claim_type).map(|s| s.as_str())
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

    /// Set principal claims.
    pub fn claims(mut self, claims: HashMap<String, String>) -> Self {
        self.context.claims = claims;
        self
    }

    /// Add a claim.
    pub fn claim(mut self, claim_type: impl Into<String>, value: impl Into<String>) -> Self {
        self.context
            .claims
            .insert(claim_type.into(), value.into());
        self
    }

    /// Set the traits.
    pub fn traits(mut self, traits: HashMap<String, serde_json::Value>) -> Self {
        self.context.traits = traits;
        self
    }

    /// Add a trait.
    pub fn trait_value(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        self.context.traits.insert(key.into(), value.into());
        self
    }

    /// Set request fields for segment filters.
    pub fn request(mut self, request: RequestContext) -> Self {
        self.context.request = Some(request);
        self
    }

    /// Attach an entity for ContextProperty evaluation.
    pub fn entity(mut self, entity: TogglyEntityContext) -> Self {
        self.context.entity = Some(entity);
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
        assert!(ctx.claims.is_empty());
        assert!(ctx.traits.is_empty());
        assert!(ctx.request.is_none());
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
            .claim("role", "admin")
            .trait_value("country", "US")
            .trait_value("age", 25)
            .request(RequestContext {
                user_agent: Some("ua".into()),
                accept_language: Some("en-US".into()),
                country: Some("US".into()),
            })
            .build();

        assert_eq!(ctx.identity, Some("user-123".to_string()));
        assert_eq!(ctx.groups, vec!["beta", "premium"]);
        assert_eq!(ctx.get_claim("role"), Some("admin"));
        assert_eq!(ctx.get_trait("country"), Some(&serde_json::json!("US")));
        assert_eq!(ctx.get_trait("age"), Some(&serde_json::json!(25)));
        assert_eq!(
            ctx.request.as_ref().and_then(|r| r.country.as_deref()),
            Some("US")
        );
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

    #[test]
    fn test_http_request_mapper_country_priority() {
        let mapped = HttpRequestMapper::from_http_headers([
            ("user-agent", "ua"),
            ("accept-language", "en"),
            ("cf-ipcountry", "US"),
            ("x-vercel-ip-country", "DE"),
            ("cloudfront-viewer-country", "FR"),
        ]);
        assert_eq!(mapped.user_agent.as_deref(), Some("ua"));
        assert_eq!(mapped.accept_language.as_deref(), Some("en"));
        assert_eq!(mapped.country.as_deref(), Some("US"));

        let vercel = HttpRequestMapper::from_http_headers([("x-vercel-ip-country", "DE")]);
        assert_eq!(vercel.country.as_deref(), Some("DE"));

        let cf = HttpRequestMapper::from_http_headers([("CloudFront-Viewer-Country", "FR")]);
        assert_eq!(cf.country.as_deref(), Some("FR"));
    }

    #[test]
    fn test_http_request_mapper_merge_into() {
        let base = EvalContext::builder().identity("u").group("beta").build();
        let merged = HttpRequestMapper::merge_into([("cf-ipcountry", "US")], Some(&base));
        assert_eq!(merged.identity.as_deref(), Some("u"));
        assert_eq!(merged.groups, vec!["beta"]);
        assert_eq!(
            merged.request.as_ref().and_then(|r| r.country.as_deref()),
            Some("US")
        );
    }

    #[test]
    fn test_request_serde_aliases() {
        let json = r#"{"userAgent":"ua","acceptLanguage":"en","country":"US"}"#;
        let request: RequestContext = serde_json::from_str(json).unwrap();
        assert_eq!(request.user_agent.as_deref(), Some("ua"));
        assert_eq!(request.accept_language.as_deref(), Some("en"));
        assert_eq!(request.country.as_deref(), Some("US"));
    }
}
