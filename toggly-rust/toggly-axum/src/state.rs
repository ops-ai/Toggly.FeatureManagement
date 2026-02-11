//! State extension for Axum.

use std::sync::Arc;
use toggly::{EvalContext, TogglyClient};

/// State wrapper for Toggly client.
///
/// # Example
///
/// ```rust,ignore
/// use axum::{routing::get, Router, extract::State};
/// use toggly_axum::TogglyState;
///
/// async fn handler(State(toggly): State<TogglyState>) -> &'static str {
///     if toggly.is_enabled("my-feature").await {
///         "Enabled"
///     } else {
///         "Disabled"
///     }
/// }
///
/// let toggly = TogglyState::new(client);
/// let app = Router::new()
///     .route("/", get(handler))
///     .with_state(toggly);
/// ```
#[derive(Clone)]
pub struct TogglyState {
    client: Arc<TogglyClient>,
}

impl TogglyState {
    /// Create a new state wrapper.
    pub fn new(client: TogglyClient) -> Self {
        Self {
            client: Arc::new(client),
        }
    }

    /// Create from an Arc.
    pub fn from_arc(client: Arc<TogglyClient>) -> Self {
        Self { client }
    }

    /// Get a reference to the client.
    pub fn client(&self) -> &TogglyClient {
        &self.client
    }

    /// Get the Arc-wrapped client.
    pub fn client_arc(&self) -> Arc<TogglyClient> {
        Arc::clone(&self.client)
    }

    /// Check if a feature is enabled.
    pub async fn is_enabled(&self, feature_key: &str) -> bool {
        self.is_enabled_with_context(feature_key, EvalContext::default())
            .await
    }

    /// Check if a feature is enabled with context.
    pub async fn is_enabled_with_context(
        &self,
        feature_key: &str,
        context: EvalContext,
    ) -> bool {
        self.client
            .is_enabled(feature_key, context)
            .await
            .unwrap_or(false)
    }

    /// Check if a feature is disabled.
    pub async fn is_disabled(&self, feature_key: &str) -> bool {
        !self.is_enabled(feature_key).await
    }
}

impl std::ops::Deref for TogglyState {
    type Target = TogglyClient;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

#[cfg(test)]
mod tests {
    // Tests would require a mock client
}
