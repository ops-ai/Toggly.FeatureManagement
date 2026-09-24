//! Request guards for Rocket.

use rocket::{
    http::Status,
    outcome::Outcome,
    request::{self, FromRequest, Request},
    State,
};
use toggly::{EvalContext, TogglyClient};

/// Request guard for feature checks.
///
/// # Example
///
/// ```rust,ignore
/// use rocket::get;
/// use toggly_rocket::Feature;
///
/// #[get("/")]
/// async fn index(feature: Feature) -> &'static str {
///     if feature.is_enabled("my-feature").await {
///         "Feature enabled!"
///     } else {
///         "Feature disabled"
///     }
/// }
/// ```
pub struct Feature<'r> {
    client: &'r TogglyClient,
    context: EvalContext,
}

impl<'r> Feature<'r> {
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

    /// Assign a feature variant using this request's evaluation context.
    ///
    /// When the request has no identity header, the client's config /
    /// `set_identity` default is used (see [`TogglyClient::get_variant`]).
    pub async fn get_variant(
        &self,
        feature_key: &str,
    ) -> toggly::Result<toggly::VariantAssignment> {
        self.client
            .get_variant(feature_key, self.context.clone())
            .await
    }

    /// Variant configuration payload for this request's context, or `None`.
    pub async fn get_variant_value(
        &self,
        feature_key: &str,
    ) -> toggly::Result<Option<serde_json::Value>> {
        self.client
            .get_variant_value(feature_key, self.context.clone())
            .await
    }

    /// Get the underlying client.
    pub fn client(&self) -> &TogglyClient {
        self.client
    }

    /// Get the evaluation context.
    pub fn context(&self) -> &EvalContext {
        &self.context
    }
}

#[rocket::async_trait]
impl<'r> FromRequest<'r> for Feature<'r> {
    type Error = ();

    async fn from_request(request: &'r Request<'_>) -> request::Outcome<Self, Self::Error> {
        let client = match request.guard::<&State<TogglyClient>>().await {
            Outcome::Success(c) => c.inner(),
            _ => return Outcome::Error((Status::InternalServerError, ())),
        };

        // Extract identity from headers
        let identity = request
            .headers()
            .get_one("X-User-Id")
            .or_else(|| request.headers().get_one("X-Identity"))
            .map(String::from);

        let context = match identity {
            Some(id) => EvalContext::with_identity(id),
            None => EvalContext::default(),
        };

        Outcome::Success(Feature { client, context })
    }
}

/// Request guard that requires a feature to be enabled.
///
/// Returns 404 if the feature is disabled.
///
/// Use the `require_feature` function to create this guard.
///
/// # Example
///
/// ```rust,ignore
/// use rocket::get;
/// use toggly_rocket::FeatureEnabled;
///
/// #[get("/beta")]
/// async fn beta(_guard: FeatureEnabled) -> &'static str {
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

/// Request guard that requires a feature to be disabled.
///
/// Returns 404 if the feature is enabled.
///
/// # Example
///
/// ```rust,ignore
/// use rocket::get;
/// use toggly_rocket::FeatureDisabled;
///
/// #[get("/legacy")]
/// async fn legacy(_guard: FeatureDisabled) -> &'static str {
///     "Legacy content"
/// }
/// ```
pub struct FeatureDisabled {
    /// The feature that was checked.
    pub feature_key: String,
}

impl FeatureDisabled {
    /// Get the feature key that was checked.
    pub fn feature_key(&self) -> &str {
        &self.feature_key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_enabled_key() {
        let fe = FeatureEnabled {
            feature_key: "test".to_string(),
        };
        assert_eq!(fe.feature_key(), "test");
    }

    #[test]
    fn test_feature_disabled_key() {
        let fd = FeatureDisabled {
            feature_key: "test".to_string(),
        };
        assert_eq!(fd.feature_key(), "test");
    }
}
