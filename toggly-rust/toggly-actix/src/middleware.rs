//! Toggly middleware for Actix-web.

use actix_web::{
    body::EitherBody,
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::StatusCode,
    Error, HttpResponse,
};
use futures_util::future::LocalBoxFuture;
use std::{
    future::{ready, Ready},
    rc::Rc,
};
use toggly::EvalContext;
use tracing::{debug, warn};

/// Middleware for feature flag checks.
///
/// This middleware can be used to gate entire routes or route groups
/// behind feature flags.
pub struct TogglyMiddleware {
    feature_key: Option<String>,
    negate: bool,
    identity_header: Option<String>,
}

impl TogglyMiddleware {
    /// Create a new middleware instance.
    pub fn new() -> Self {
        Self {
            feature_key: None,
            negate: false,
            identity_header: None,
        }
    }

    /// Create a middleware that checks a specific feature.
    pub fn with_feature(feature_key: impl Into<String>) -> Self {
        Self {
            feature_key: Some(feature_key.into()),
            negate: false,
            identity_header: None,
        }
    }

    /// Negate the feature check (feature must be disabled).
    pub fn negate(mut self) -> Self {
        self.negate = true;
        self
    }

    /// Set the header name for extracting user identity.
    pub fn identity_header(mut self, header: impl Into<String>) -> Self {
        self.identity_header = Some(header.into());
        self
    }
}

impl Default for TogglyMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

impl<S, B> Transform<S, ServiceRequest> for TogglyMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = TogglyMiddlewareService<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(TogglyMiddlewareService {
            service: Rc::new(service),
            feature_key: self.feature_key.clone(),
            negate: self.negate,
            identity_header: self.identity_header.clone(),
        }))
    }
}

/// The actual middleware service.
pub struct TogglyMiddlewareService<S> {
    service: Rc<S>,
    feature_key: Option<String>,
    negate: bool,
    identity_header: Option<String>,
}

impl<S, B> Service<ServiceRequest> for TogglyMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        let feature_key = self.feature_key.clone();
        let negate = self.negate;
        let identity_header = self.identity_header.clone();

        Box::pin(async move {
            // If no feature key, just pass through
            let feature_key = match feature_key {
                Some(key) => key,
                None => {
                    let res = service.call(req).await?;
                    return Ok(res.map_into_left_body());
                }
            };

            // Get client from app data
            let client = req
                .app_data::<actix_web::web::Data<toggly::TogglyClient>>()
                .cloned();

            let client = match client {
                Some(c) => c,
                None => {
                    warn!("TogglyClient not found in app data");
                    let res = service.call(req).await?;
                    return Ok(res.map_into_left_body());
                }
            };

            // Extract identity from header if configured
            let identity = identity_header.as_ref().and_then(|h| {
                req.headers()
                    .get(h)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from)
            });

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
                let res = service.call(req).await?;
                Ok(res.map_into_left_body())
            } else {
                debug!(feature = %feature_key, "Feature check failed, returning 404");
                let response = HttpResponse::new(StatusCode::NOT_FOUND);
                Ok(req.into_response(response).map_into_right_body())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_middleware_builder() {
        let middleware = TogglyMiddleware::new()
            .identity_header("X-User-Id")
            .negate();

        assert!(middleware.negate);
        assert_eq!(middleware.identity_header, Some("X-User-Id".to_string()));
    }

    #[test]
    fn test_with_feature() {
        let middleware = TogglyMiddleware::with_feature("my-feature");
        assert_eq!(middleware.feature_key, Some("my-feature".to_string()));
    }
}
