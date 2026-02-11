//! Extractors for Actix-web handlers.

use actix_web::{dev::Payload, web, Error, FromRequest, HttpRequest};
use futures_util::future::{ok, Ready};
use toggly::{EvalContext, TogglyClient};

/// Extractor for the Toggly client from app data.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{web, HttpResponse};
/// use toggly_actix::TogglyData;
///
/// async fn handler(toggly: TogglyData) -> HttpResponse {
///     let enabled = toggly.is_enabled("my-feature", Default::default()).await.unwrap();
///     if enabled {
///         HttpResponse::Ok().body("Feature enabled!")
///     } else {
///         HttpResponse::Ok().body("Feature disabled")
///     }
/// }
/// ```
pub struct TogglyData(web::Data<TogglyClient>);

impl TogglyData {
    /// Get a reference to the inner client.
    pub fn client(&self) -> &TogglyClient {
        &self.0
    }

    /// Check if a feature is enabled.
    pub async fn is_enabled(&self, feature_key: &str, context: EvalContext) -> toggly::Result<bool> {
        self.0.is_enabled(feature_key, context).await
    }

    /// Check if a feature is disabled.
    pub async fn is_disabled(&self, feature_key: &str, context: EvalContext) -> toggly::Result<bool> {
        self.0.is_disabled(feature_key, context).await
    }
}

impl std::ops::Deref for TogglyData {
    type Target = TogglyClient;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl FromRequest for TogglyData {
    type Error = Error;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        match req.app_data::<web::Data<TogglyClient>>() {
            Some(client) => ok(TogglyData(client.clone())),
            None => {
                // This should never happen if properly configured
                panic!("TogglyClient not configured in app data")
            }
        }
    }
}

/// Extractor that indicates a feature was checked.
///
/// Use with the Feature extractor to check features dynamically.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::HttpResponse;
/// use toggly_actix::FeatureEnabled;
///
/// async fn beta_handler(_feature: FeatureEnabled) -> HttpResponse {
///     HttpResponse::Ok().body("Beta content")
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

/// Dynamic feature extractor.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{web, HttpResponse};
/// use toggly_actix::Feature;
///
/// async fn handler(feature: Feature) -> HttpResponse {
///     if feature.is_enabled("my-feature").await {
///         HttpResponse::Ok().body("Enabled")
///     } else {
///         HttpResponse::Ok().body("Disabled")
///     }
/// }
/// ```
pub struct Feature {
    client: web::Data<TogglyClient>,
    context: EvalContext,
}

impl Feature {
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

    /// Get the underlying context.
    pub fn context(&self) -> &EvalContext {
        &self.context
    }
}

impl FromRequest for Feature {
    type Error = Error;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {
        let client = req
            .app_data::<web::Data<TogglyClient>>()
            .cloned()
            .expect("TogglyClient not configured");

        // Extract identity from common headers
        let identity = req
            .headers()
            .get("X-User-Id")
            .or_else(|| req.headers().get("X-Identity"))
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let context = match identity {
            Some(id) => EvalContext::with_identity(id),
            None => EvalContext::default(),
        };

        ok(Feature { client, context })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature_enabled_key() {
        let fe = FeatureEnabled { feature_key: "test".to_string() };
        assert_eq!(fe.feature_key(), "test");
    }
}
