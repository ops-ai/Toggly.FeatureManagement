//! Axum extractors for Toggly.

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
};
use std::sync::Arc;
use toggly::{EvalContext, TogglyClient};

/// Extractor for dynamic feature checks.
///
/// # Example
///
/// ```rust,ignore
/// use axum::response::IntoResponse;
/// use toggly_axum::Feature;
///
/// async fn handler(feature: Feature) -> impl IntoResponse {
///     if feature.is_enabled("my-feature").await {
///         "Feature enabled!".into_response()
///     } else {
///         "Feature disabled".into_response()
///     }
/// }
/// ```
pub struct Feature {
    client: Arc<TogglyClient>,
    context: EvalContext,
}

impl Feature {
    /// Create a new feature extractor with the given client and context.
    pub fn new(client: Arc<TogglyClient>, context: EvalContext) -> Self {
        Self { client, context }
    }

    /// Check if a feature is enabled.
    pub async fn is_enabled(&self, feature_key: &str) -> bool {
        self.client
            .is_enabled(feature_key, self.context.clone())
            .await
            .unwrap_or(false)
    }

    /// Check if a feature is disabled.
    pub async fn is_disabled(&self, feature_key: &str) -> bool {
        !self.is_enabled(feature_key).await
    }

    /// Get the underlying client.
    pub fn client(&self) -> &TogglyClient {
        &self.client
    }

    /// Get the evaluation context.
    pub fn context(&self) -> &EvalContext {
        &self.context
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for Feature
where
    S: Send + Sync,
{
    type Rejection = FeatureRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Try to get client from Extension
        let client = parts
            .extensions
            .get::<Arc<TogglyClient>>()
            .cloned()
            .ok_or(FeatureRejection::ClientNotFound)?;

        // Extract identity from headers
        let identity = parts
            .headers
            .get("x-user-id")
            .or_else(|| parts.headers.get("x-identity"))
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let context = match identity {
            Some(id) => EvalContext::with_identity(id),
            None => EvalContext::default(),
        };

        Ok(Feature::new(client, context))
    }
}

/// Extractor that requires a specific feature to be enabled.
///
/// Use the `require_feature` function to create this extractor.
///
/// # Example
///
/// ```rust,ignore
/// use axum::response::IntoResponse;
/// use toggly_axum::FeatureEnabled;
///
/// async fn beta_handler(_: FeatureEnabled) -> impl IntoResponse {
///     "Welcome to the beta!"
/// }
/// ```
pub struct FeatureEnabled {
    /// The feature that was checked.
    pub feature_key: String,
}

impl FeatureEnabled {
    /// Get the feature key that was checked.
    pub fn feature_key(&self) -> &str {
        &self.feature_key
    }
}

/// Extractor for the Toggly client directly.
///
/// # Example
///
/// ```rust,ignore
/// use toggly_axum::TogglyExtractor;
///
/// async fn handler(toggly: TogglyExtractor) -> &'static str {
///     let enabled = toggly.is_enabled("my-feature", Default::default()).await.unwrap();
///     if enabled { "Yes" } else { "No" }
/// }
/// ```
pub struct TogglyExtractor(pub Arc<TogglyClient>);

impl std::ops::Deref for TogglyExtractor {
    type Target = TogglyClient;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for TogglyExtractor
where
    S: Send + Sync,
{
    type Rejection = FeatureRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let client = parts
            .extensions
            .get::<Arc<TogglyClient>>()
            .cloned()
            .ok_or(FeatureRejection::ClientNotFound)?;

        Ok(TogglyExtractor(client))
    }
}

/// Rejection type for feature extractors.
#[derive(Debug)]
pub enum FeatureRejection {
    /// Toggly client not found in extensions.
    ClientNotFound,
    /// Feature is disabled.
    FeatureDisabled,
    /// Error evaluating the feature.
    EvaluationError,
}

impl IntoResponse for FeatureRejection {
    fn into_response(self) -> Response {
        match self {
            FeatureRejection::ClientNotFound => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Toggly client not configured",
            )
                .into_response(),
            FeatureRejection::FeatureDisabled => {
                (StatusCode::NOT_FOUND, "Feature not available").into_response()
            }
            FeatureRejection::EvaluationError => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Feature evaluation error",
            )
                .into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_rejection_into_response() {
        let rejection = FeatureRejection::FeatureDisabled;
        let response = rejection.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
