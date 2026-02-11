//! Tower layer for feature flag middleware.

use axum::http::{Request, Response, StatusCode};
use futures_util::future::BoxFuture;
use http_body::Body;
use std::{
    sync::Arc,
    task::{Context, Poll},
};
use toggly::{EvalContext, TogglyClient};
use tower::{Layer, Service};
use tracing::{debug, warn};

/// Tower layer for feature flag checks.
///
/// # Example
///
/// ```rust,ignore
/// use axum::{routing::get, Router};
/// use toggly_axum::TogglyLayer;
///
/// let app = Router::new()
///     .route("/beta", get(handler).layer(TogglyLayer::require("beta-features")));
/// ```
#[derive(Clone)]
pub struct TogglyLayer {
    feature_key: String,
    negate: bool,
    identity_header: Option<String>,
}

impl TogglyLayer {
    /// Create a layer that requires a feature to be enabled.
    pub fn require(feature_key: impl Into<String>) -> Self {
        Self {
            feature_key: feature_key.into(),
            negate: false,
            identity_header: None,
        }
    }

    /// Create a layer that requires a feature to be disabled.
    pub fn deny(feature_key: impl Into<String>) -> Self {
        Self {
            feature_key: feature_key.into(),
            negate: true,
            identity_header: None,
        }
    }

    /// Set the header name for extracting user identity.
    pub fn identity_header(mut self, header: impl Into<String>) -> Self {
        self.identity_header = Some(header.into());
        self
    }

    /// Negate the feature check.
    pub fn negate(mut self) -> Self {
        self.negate = !self.negate;
        self
    }
}

impl<S> Layer<S> for TogglyLayer {
    type Service = TogglyService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        TogglyService {
            inner,
            feature_key: self.feature_key.clone(),
            negate: self.negate,
            identity_header: self.identity_header.clone(),
        }
    }
}

/// The middleware service.
#[derive(Clone)]
pub struct TogglyService<S> {
    inner: S,
    feature_key: String,
    negate: bool,
    identity_header: Option<String>,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for TogglyService<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send,
    ReqBody: Send + 'static,
    ResBody: Body + Default + Send + 'static,
{
    type Response = Response<ResBody>;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<ReqBody>) -> Self::Future {
        let feature_key = self.feature_key.clone();
        let negate = self.negate;
        let identity_header = self.identity_header.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            // Get client from extensions
            let client = req.extensions().get::<Arc<TogglyClient>>().cloned();

            let client = match client {
                Some(c) => c,
                None => {
                    warn!("TogglyClient not found in request extensions");
                    // Allow through if no client configured
                    return inner.call(req).await;
                }
            };

            // Extract identity from header
            let identity = identity_header
                .as_ref()
                .and_then(|h| req.headers().get(h))
                .or_else(|| req.headers().get("x-user-id"))
                .or_else(|| req.headers().get("x-identity"))
                .and_then(|v| v.to_str().ok())
                .map(String::from);

            let context = match identity {
                Some(id) => EvalContext::with_identity(id),
                None => EvalContext::default(),
            };

            // Check feature
            let enabled = client
                .is_enabled(&feature_key, context)
                .await
                .unwrap_or(false);

            let should_allow = if negate { !enabled } else { enabled };

            if should_allow {
                debug!(feature = %feature_key, "Feature check passed");
                inner.call(req).await
            } else {
                debug!(feature = %feature_key, "Feature check failed, returning 404");
                let response = Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(ResBody::default())
                    .unwrap();
                Ok(response)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layer_require() {
        let layer = TogglyLayer::require("my-feature");
        assert_eq!(layer.feature_key, "my-feature");
        assert!(!layer.negate);
    }

    #[test]
    fn test_layer_deny() {
        let layer = TogglyLayer::deny("my-feature");
        assert_eq!(layer.feature_key, "my-feature");
        assert!(layer.negate);
    }

    #[test]
    fn test_layer_identity_header() {
        let layer = TogglyLayer::require("my-feature").identity_header("X-Custom-Id");
        assert_eq!(layer.identity_header, Some("X-Custom-Id".to_string()));
    }
}
